import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import TiereDetailPage from './TiereDetailPage';
import type { Tier } from '../api/types';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-29 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-29 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-29 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const tierBasis: Tier = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'aktiv', spezies: 'hund',
  rasse_beschreibung: 'Schäferhund', rufname: 'Rex', geschlecht: 'maennlich',
  alter_geschaetzt: 3, farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
  halter_person_id: null, halter_kontakt: null, antreff_ort: 'Weide', notiz: null,
  abschluss_grund: null, abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00', erfasst_von: 1, geaendert_at: '2026-05-29 09:00:00',
  geaendert_von: 1, storniert_at: null, halter_registrier_nr: null, halter_storniert_at: null,
};

function render(
  einsatzObj: typeof einsatzAktiv,
  tier: Tier,
  extra: Parameters<typeof server.use> = [],
  route = '/einsaetze/1/tiere/10',
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/tiere/10', () => HttpResponse.json(tier)),
  );
  // extra-Handler separat prependen, damit sie Vorrang vor den Default-Handlern haben.
  if (extra.length > 0) server.use(...extra);
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/tiere" element={<div>LISTE</div>} />
        <Route path="/einsaetze/:id/tiere/:tierId" element={<TiereDetailPage />} />
        <Route path="/einsaetze/:id/personen/:personId" element={<div>PERSON-DETAIL</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('TiereDetailPage — Stammdaten', () => {
  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, tierBasis);
    expect(await screen.findByRole('heading', { name: /Tier T-001/ })).toBeInTheDocument();
    expect(screen.getByText('Schäferhund')).toBeInTheDocument();
    expect(screen.getByText('Weide')).toBeInTheDocument();
  });

  it('Einsatzleitung kann bearbeiten und speichern', async () => {
    // Edit-Modus öffnen, das mit den Bestandswerten vorbefüllte Formular direkt speichern
    // und den PATCH-Aufruf verifizieren (kein getByLabelText — antd bindet label/htmlFor nicht zuverlässig).
    let gesendet = false;
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async () => {
        gesendet = true;
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(gesendet).toBe(true));
  });

  it('Beobachter sieht keinen Bearbeiten-Button', async () => {
    render(einsatzBeobachter, tierBasis);
    await screen.findByRole('heading', { name: /Tier T-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('Halter-Link deeplinkt bei bekanntem Halter auf die Personen-Detailseite', async () => {
    const mitHalter: Tier = { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7 };
    render(einsatzAktiv, mitHalter);
    await userEvent.click(await screen.findByText('R-007'));
    expect(await screen.findByText('PERSON-DETAIL')).toBeInTheDocument();
  });
});

describe('TiereDetailPage — Status/Abschluss', () => {
  it('zeigt den Abschluss-Block bei abgeschlossen', async () => {
    const abgeschlossen: Tier = {
      ...tierBasis, status: 'abgeschlossen',
      abschluss_grund: 'uebergabe_tierarzt', abschluss_ziel: 'Tierarzt Müller',
    };
    render(einsatzAktiv, abgeschlossen);
    expect(await screen.findByText('Übergabe an Tierarzt')).toBeInTheDocument();
    expect(screen.getByText('Tierarzt Müller')).toBeInTheDocument();
  });

  it('„Als vermisst markieren" ruft die Status-Mutation', async () => {
    let body: { status?: string } = {};
    render(einsatzAktiv, tierBasis, [
      http.post('/api/einsaetze/1/tiere/10/status', async ({ request }) => {
        body = await request.json() as { status?: string };
        return HttpResponse.json({ ...tierBasis, status: 'vermisst' });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Als vermisst markieren' }));
    await vi.waitFor(() => expect(body.status).toBe('vermisst'));
  });

  it('Abschließen-Modal erzwingt einen Grund und schickt ihn', async () => {
    let body: { status?: string; abschluss_grund?: string } = {};
    render(einsatzAktiv, tierBasis, [
      http.post('/api/einsaetze/1/tiere/10/status', async ({ request }) => {
        body = await request.json() as { status?: string; abschluss_grund?: string };
        return HttpResponse.json({ ...tierBasis, status: 'abgeschlossen', abschluss_grund: 'freilauf' });
      }),
    ]);
    // Header-Button „Abschließen" öffnet das Modal (vor dem Öffnen gibt es nur diesen einen).
    await userEvent.click(await screen.findByRole('button', { name: 'Abschließen' }));
    // Auf der Detailseite ist das Abschluss-Modal der einzige Dialog.
    const dialog = (await screen.findAllByRole('dialog'))[0];
    // Ohne Grund: Submit blockiert (Pflichtfeld) → kein Request.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    expect(await screen.findByText('Grund ist Pflicht')).toBeInTheDocument();
    expect(body.status).toBeUndefined();
    // Mit Grund:
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('Freilauf')); // Option rendert im Portal → global
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    await vi.waitFor(() => expect(body.abschluss_grund).toBe('freilauf'));
    expect(body.status).toBe('abgeschlossen');
  });
});

describe('TiereDetailPage — Robustheit', () => {
  it('leitet bei ungültiger Tier-ID auf die Liste um', async () => {
    render(einsatzAktiv, tierBasis, [], '/einsaetze/1/tiere/abc');
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, tierBasis, [
      http.get('/api/einsaetze/1/tiere/10', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Tier konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });
});
