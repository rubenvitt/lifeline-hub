import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonenDetailPage from './PersonenDetailPage';
import type { PersonDetail, Sichtungskategorie } from '../api/types';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const detail = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
  name: 'Mustermann', vorname: 'Max', geschlecht: 'maennlich', geburtsdatum: null,
  alter_geschaetzt: 40, herkunft_adresse: null, antreff_ort: 'Brücke', melder_kontakt: null,
  notiz: null, erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1, storniert_at: null,
  aktuelle_sichtung: null, aktuelle_sichtung_at: null, aktueller_verbleib: null,
  aktuelle_uhs_id: null, aktueller_platz_id: null,
  sichtungen: [], notizen: [], verbleib: [], abgleiche: [],
} as PersonDetail;

function render(einsatzObj: typeof einsatzAktiv, person: PersonDetail, extra: Parameters<typeof server.use> = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personen/10/audit', () => HttpResponse.json([])),
  );
  // extra-Handler separat prependen, damit sie Vorrang vor den Default-Handlern haben.
  if (extra.length > 0) server.use(...extra);
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<div>LISTE</div>} />
        <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/personen/10' },
  );
}

describe('PersonenDetailPage — med. Verlauf', () => {
  it('Re-Sichten ruft erfasseSichtung mit SK II', async () => {
    let gerufen: { kategorie?: string } = {};
    render(einsatzAktiv, detail, [
      http.post('/api/einsaetze/1/personen/10/sichtung', async ({ request }) => {
        gerufen = await request.json() as { kategorie?: string };
        return HttpResponse.json({ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'sk2',
          notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }, { status: 201 });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Re-Sichten' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Kategorie/ }));
    await userEvent.click(await screen.findByText('SK II'));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await vi.waitFor(() => expect(gerufen.kategorie).toBe('sk2'));
  });

  it('zeigt bei Sichtung=tot den Hinweis „Status → verstorben"', async () => {
    const totDetail = { ...detail, aktuelle_sichtung: 'tot' as Sichtungskategorie, aktuelle_sichtung_at: '2026-05-27 10:00:00',
      sichtungen: [{ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'tot' as Sichtungskategorie,
        notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }] } as PersonDetail;
    render(einsatzAktiv, totDetail);
    expect(await screen.findByRole('button', { name: /Status → verstorben/ })).toBeInTheDocument();
  });
});

describe('PersonenDetailPage — Stammdaten', () => {
  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, detail);
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
    expect(screen.getByText('Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Brücke')).toBeInTheDocument();
  });

  it('Einsatzleitung kann bearbeiten und speichern', async () => {
    // Robust: kein getByLabelText (antd Form bindet label/htmlFor nicht zuverlässig).
    // Edit-Modus öffnen, das mit initialValues={p} vorbefüllte Formular direkt speichern
    // und den PATCH-Aufruf verifizieren.
    let gesendet = false;
    render(einsatzAktiv, detail, [
      http.patch('/api/einsaetze/1/personen/10', async () => {
        gesendet = true;
        return HttpResponse.json({ ...detail });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(gesendet).toBe(true));
  });

  it('Beobachter sieht keinen Bearbeiten-Button', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('zeigt Stammdaten UND med. Verlauf gleichzeitig (zwei Spalten, ohne Tabs)', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.getByText('Stammdaten')).toBeInTheDocument();
    expect(screen.getByText(/Chronologischer Verlauf/)).toBeInTheDocument();
    // Keine Tab-Leiste mehr:
    expect(screen.queryByRole('tab', { name: 'Medizinischer Verlauf' })).not.toBeInTheDocument();
  });
});

describe('PersonenDetailPage — Robustheit', () => {
  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('zeigt das Patient-Tag bei gesichteter Person (SK I)', async () => {
    const patient = { ...detail, status: 'betroffen', aktuelle_sichtung: 'sk1',
      aktuelle_sichtung_at: '2026-05-27 10:00:00' } as PersonDetail;
    render(einsatzAktiv, patient);
    expect((await screen.findAllByText('Patient')).length).toBeGreaterThan(0);
  });

  it('zeigt KEIN Patient-Tag bei unverletzter Person', async () => {
    const unverletzt = { ...detail, status: 'betroffen', aktuelle_sichtung: 'unverletzt',
      aktuelle_sichtung_at: '2026-05-27 10:00:00' } as PersonDetail;
    render(einsatzAktiv, unverletzt);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByText('Patient')).not.toBeInTheDocument();
  });
});
