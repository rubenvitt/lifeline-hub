import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonenPage from './PersonenPage';

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

const person = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
  name: 'Mustermann', vorname: 'Max', geschlecht: 'maennlich', geburtsdatum: null,
  alter_geschaetzt: 40, herkunft_adresse: null, antreff_ort: 'Brücke', melder_kontakt: null,
  notiz: null, erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1, storniert_at: null,
};
const unbekannt = { ...person, id: 11, registrier_nr: 2, name: null, vorname: null, status: 'vermisst' };

function render(einsatzObj: typeof einsatzAktiv, personen: unknown[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/personen' },
  );
}

describe('PersonenPage', () => {
  it('zeigt Personen der Sicht „Neu" mit Registriernummer und Status', async () => {
    render(einsatzAktiv, [person, unbekannt]);
    expect(await screen.findByText('R-001')).toBeInTheDocument();
    expect(screen.getByText('Mustermann, Max')).toBeInTheDocument();
    // unbekannt (vermisst) ist in der Default-Sicht „Neu" (erfasst) NICHT sichtbar:
    expect(screen.queryByText('R-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Vermisst und zeigt „unbekannt"', async () => {
    render(einsatzAktiv, [person, unbekannt]);
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('R-002')).toBeInTheDocument();
    expect(screen.getByText('unbekannt')).toBeInTheDocument();
  });

  it('Einsatzleitung sieht die Anlege-Buttons', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Personen' });
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Betroffene/n erfassen' })).toBeInTheDocument();
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [person]);
    await screen.findByText('R-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('öffnet den Detail-Drawer beim Klick auf eine Zeile', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person]);
    const zelle = (await screen.findAllByText('Mustermann, Max'))[0];
    await userEvent.click(zelle);
    expect(await screen.findByText('Person R-001')).toBeInTheDocument();
  });
});
