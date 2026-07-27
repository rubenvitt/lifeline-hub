import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import TierePage from './TierePage';
import type { Tier } from '../api/types';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): so prüfen die Rollen-Tests die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1, anzeigename: 'Nutzer', benutzername: 'nutzer', system_rolle: 'keiner',
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
const tierVermisst: Tier = { ...tierBasis, id: 11, registrier_nr: 2, status: 'vermisst', spezies: 'katze', rufname: 'Mimi' };

function render(einsatzObj: typeof einsatzAktiv, tiere: Tier[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json(tiere)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/tiere" element={<TierePage />} />
        <Route path="/einsaetze/:id/tiere/:tierId" element={<div>DETAIL-SEITE</div>} />
        <Route path="/einsaetze/:id/personen" element={<div>Personen-Modul</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/tiere' },
  );
}

describe('TierePage', () => {
  it('zeigt aktive Tiere mit T-Nummer und Status', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    expect(await screen.findByText('T-001')).toBeInTheDocument();
    expect(screen.getByText('Rex')).toBeInTheDocument();
    // vermisste Katze ist in der Default-Sicht „Aktiv" nicht sichtbar:
    expect(screen.queryByText('T-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Vermisst', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    await screen.findByText('T-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('T-002')).toBeInTheDocument();
    expect(screen.getByText('Mimi')).toBeInTheDocument();
  });

  it('filtert nach Spezies', async () => {
    render(einsatzAktiv, [tierBasis, { ...tierBasis, id: 12, registrier_nr: 3, spezies: 'katze', rufname: 'Felix' }]);
    await screen.findByText('Rex');
    await userEvent.click(screen.getByRole('combobox'));
    // Tabellenzelle und Dropdown-Option tragen beide "Katze" → auf die Option im Dropdown zielen.
    const katzeOption = (await screen.findAllByText('Katze')).find((el) => el.closest('.ant-select-item-option'));
    expect(katzeOption).toBeTruthy();
    await userEvent.click(katzeOption!);
    expect(await screen.findByText('Felix')).toBeInTheDocument();
    expect(screen.queryByText('Rex')).not.toBeInTheDocument();
  });

  it('Einsatzleitung sieht Anlege-Buttons', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Tiere' });
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [tierBasis]);
    await screen.findByText('T-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('Schnellerfassung schickt status=aktiv + spezies', async () => {
    let body: { spezies?: string; status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { spezies?: string; status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99 }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('aktiv'));
    expect(body.spezies).toBe('hund'); // initialValues
  });

  it('Vermisst-Meldung schickt status=vermisst', async () => {
    let body: { status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99, status: 'vermisst' }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('vermisst'));
  });

  it('navigiert beim Klick auf eine Zeile zur Detail-Vollseite', async () => {
    render(einsatzAktiv, [tierBasis]);
    await userEvent.click((await screen.findAllByText('Rex'))[0]);
    // Drawer entfernt (LFH-147) → Zeilen-Klick navigiert auf /tiere/:tierId.
    expect(await screen.findByText('DETAIL-SEITE')).toBeInTheDocument();
  });

  it('zeigt die Halter-R-Nr und „storniert" aus den Join-Feldern', async () => {
    const mitHalter: Tier = { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7, halter_storniert_at: '2026-05-29 11:00:00' };
    render(einsatzAktiv, [mitHalter]);
    expect(await screen.findByText(/Halter \(storniert\): R-007/)).toBeInTheDocument();
  });
});
