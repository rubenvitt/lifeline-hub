import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonenPage from './PersonenPage';
import PersonenDetailPage from './PersonenDetailPage';

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

function render(einsatzObj: typeof einsatzAktiv, personen: unknown[], route = '/einsaetze/1/personen') {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
        <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route },
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

  it('leitet den Alt-Deep-Link ?person=<id> auf die Detailseite um', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person], '/einsaetze/1/personen?person=10');
    // Redirect → Detailseite rendert den Heading:
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
  });

  it('zeigt SK-Badge und Lagebild-Zählungen', async () => {
    const gesichtet = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    render(einsatzAktiv, [person, unbekannt, gesichtet]);
    // Liste-Sicht „Alle" wählen, dann nach SK-Tag suchen
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
    expect(await screen.findByText('SK II')).toBeInTheDocument();
    // Lagebild: „SK II: 1", „ungesichtet: 2" (person + unbekannt)
    expect(screen.getByText(/SK II:\s*1/)).toBeInTheDocument();
    expect(screen.getByText(/ungesichtet:\s*2/)).toBeInTheDocument();
  });

  it('Patienten-Tab gruppiert SK I–IV + tot in Abschnitte, ohne unverletzt/ungesichtet', async () => {
    const sk2 = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const totVerstorben = { ...person, id: 13, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const unverletzt = { ...person, id: 14, registrier_nr: 5, status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const, aktuelle_sichtung_at: '2026-05-27 09:50:00' };
    render(einsatzAktiv, [person, sk2, totVerstorben, unverletzt]);
    await screen.findByText('R-001'); // ungesichtete Person im „Neu"-Tab
    await userEvent.click(screen.getByRole('tab', { name: 'Patienten' }));
    // SK-II-Abschnitt + tot-Abschnitt: beide Patienten sichtbar:
    expect(await screen.findByText('R-003')).toBeInTheDocument();
    expect(screen.getByText('R-004')).toBeInTheDocument();
    // Zwei Abschnitte mit je einem Patienten:
    expect(screen.getAllByText('1 Patient')).toHaveLength(2);
    // unverletzt (R-005) und ungesichtet (R-001) sind KEINE Patienten:
    expect(screen.queryByText('R-005')).not.toBeInTheDocument();
    expect(screen.queryByText('R-001')).not.toBeInTheDocument();
    // Achsen-Überlappung: verstorben+tot erscheint AUCH im Verstorben-Tab:
    await userEvent.click(screen.getByRole('tab', { name: 'Verstorben' }));
    expect(await screen.findByText('R-004')).toBeInTheDocument();
  });

  it('Patienten-Tab zeigt einen Leer-Hinweis, wenn niemand gesichtet ist', async () => {
    render(einsatzAktiv, [person, unbekannt]); // beide ungesichtet
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Patienten' }));
    expect(await screen.findByText(/Keine Patienten/)).toBeInTheDocument();
  });

  it('Lagebild-Streifen zeigt „Patienten: N" (SK I–IV + tot)', async () => {
    const sk2 = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const tot = { ...person, id: 13, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const unverletzt = { ...person, id: 14, registrier_nr: 5, status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const, aktuelle_sichtung_at: '2026-05-27 09:50:00' };
    render(einsatzAktiv, [person, sk2, tot, unverletzt]);
    await screen.findByText('R-001');
    // Patienten = sk2 + tot = 2 (unverletzt + ungesichtet zählen nicht):
    expect(await screen.findByText(/Patienten:\s*2/)).toBeInTheDocument();
  });

  it('öffnet via ?neu=1 die Schnellerfassung', async () => {
    render(einsatzAktiv, [], '/einsaetze/1/personen?neu=1');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Schnellerfassung');
  });

  it('öffnet via ?neu=1 die Schnellerfassung NICHT für Beobachter', async () => {
    render(einsatzBeobachter, [], '/einsaetze/1/personen?neu=1');
    // Seite lädt durch (Tabelle ist leer, kein Spinner mehr)
    await screen.findByRole('heading', { name: 'Personen' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('navigiert beim Klick auf eine Zeile zur Detailseite', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person]);
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    // Detailseite zeigt den Personen-Titel als Heading:
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
  });
});
