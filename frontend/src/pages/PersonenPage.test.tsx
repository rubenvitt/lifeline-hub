import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonenPage from './PersonenPage';
import type { PersonDetail } from '../api/types';

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

function render(einsatzObj: typeof einsatzAktiv, personen: unknown[], route = '/einsaetze/1/personen') {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
    // Default-Fallback für den „Zugeordnete Tiere"-Block (Cross-Modul-Fetch).
    // Jeder Test, der einen spezifischen Handler braucht, überschreibt ihn via server.use().
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    // Default-Fallback für den „Als Geschädigte bei Schäden"-Block (Cross-Modul-Fetch).
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
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

  it('öffnet den Detail-Drawer beim Klick auf eine Zeile', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person]);
    const zelle = (await screen.findAllByText('Mustermann, Max'))[0];
    await userEvent.click(zelle);
    expect(await screen.findByText('Person R-001')).toBeInTheDocument();
  });

  it('zeigt eine Fehleranzeige im Drawer, wenn der Detail-Abruf scheitert (kein leerer Drawer)', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () =>
      HttpResponse.json({ error: 'kaputt' }, { status: 500 })));
    render(einsatzAktiv, [person]);
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('öffnet den Detail-Drawer direkt über den Deep-Link ?person=<id>', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person], '/einsaetze/1/personen?person=10');
    // Ohne Klick: der Drawer öffnet sich aus dem Query-Param (z. B. „Vollständig öffnen"
    // aus dem schlanken UHS-Drawer).
    expect(await screen.findByText('Person R-001')).toBeInTheDocument();
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

  it('Re-Sichten-Aktion ruft erfasseSichtung mit SK II und löst Refetch aus', async () => {
    const detail = { ...person, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [], notizen: [], verbleib: [], abgleiche: [] } as PersonDetail;
    let gerufen: { kategorie?: string } = {};
    server.use(
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)),
      http.post('/api/einsaetze/1/personen/10/sichtung', async ({ request }) => {
        gerufen = await request.json() as { kategorie?: string };
        return HttpResponse.json({ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'sk2',
          notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }, { status: 201 });
      }),
    );
    render(einsatzAktiv, [person]);
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Medizinischer Verlauf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Re-Sichten' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Kategorie/ }));
    await userEvent.click(await screen.findByText('SK II'));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await vi.waitFor(() => expect(gerufen.kategorie).toBe('sk2'));
  });

  it('Einsatzleitung kann einen Verdachts-Abgleich bestätigen', async () => {
    const vermisst = { ...person, id: 20, status: 'vermisst' as const };
    const gefunden = { ...person, id: 21, registrier_nr: 4, status: 'betroffen' as const };
    const detail = { ...vermisst, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [], notizen: [], verbleib: [],
      abgleiche: [{ id: 5, einsatz_id: 1, vermisst_person_id: 20, gefunden_person_id: 21,
        status: 'verdacht', erstellt_at: '2026-05-27 10:00:00', erstellt_von: 1,
        entschieden_at: null, entschieden_von: null }] } as PersonDetail;
    let entscheidung: string | undefined;
    server.use(
      http.get('/api/einsaetze/1/personen/20', () => HttpResponse.json(detail)),
      http.post('/api/einsaetze/1/personen/20/abgleich/5/entscheidung', async ({ request }) => {
        entscheidung = ((await request.json()) as { entscheidung: string }).entscheidung;
        return HttpResponse.json({ ...detail.abgleiche[0], status: 'bestaetigt' });
      }),
    );
    render(einsatzAktiv, [vermisst, gefunden]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Medizinischer Verlauf' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await vi.waitFor(() => expect(entscheidung).toBe('bestaetigt'));
  });

  it('zeigt bei Sichtung=tot den Hinweis „Status → verstorben"', async () => {
    const detail = { ...person, aktuelle_sichtung: 'tot', aktuelle_sichtung_at: '2026-05-27 10:00:00',
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [{ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'tot',
        notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }],
      notizen: [], verbleib: [], abgleiche: [] } as PersonDetail;
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)));
    render(einsatzAktiv, [person]);
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Medizinischer Verlauf' }));
    expect(await screen.findByRole('button', { name: /Status → verstorben/ })).toBeInTheDocument();
  });

  it('zeigt den „Zugeordnete Tiere"-Block im Personen-Drawer', async () => {
    const detail = { ...person, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [], notizen: [], verbleib: [], abgleiche: [] } as PersonDetail;
    server.use(
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)),
    );
    render(einsatzAktiv, [person]);
    // Tiere-Handler nach render() einsetzen, damit er Vorrang gegenüber dem
    // Default-Fallback aus render() hat (MSW-Prepend-Semantik).
    server.use(
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        // Nur der Cross-Modul-Fetch trägt halter_person_id.
        if (url.searchParams.get('halter_person_id') === '10') {
          return HttpResponse.json([{
            id: 30, einsatz_id: 1, registrier_nr: 7, status: 'aktiv', spezies: 'hund',
            rasse_beschreibung: null, rufname: 'Rex', geschlecht: null, alter_geschaetzt: null,
            farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
            halter_person_id: 10, halter_kontakt: null, antreff_ort: null, notiz: null,
            abschluss_grund: null, abschluss_ziel: null, erfasst_at: '2026-05-27 09:00:00',
            erfasst_von: 1, geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1,
            storniert_at: null, halter_registrier_nr: 1, halter_storniert_at: null,
          }]);
        }
        return HttpResponse.json([]);
      }),
    );
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    expect(await screen.findByText(/Zugeordnete Tiere/i)).toBeInTheDocument();
    expect(await screen.findByText(/T-007/)).toBeInTheDocument();
    expect(screen.getByText(/Rex/)).toBeInTheDocument();
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

  it('Detail-Drawer zeigt das „Patient"-Tag bei gesichteter Person', async () => {
    const patient = { ...person, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk1' as const, aktuelle_sichtung_at: '2026-05-27 10:00:00' };
    const detail = {
      ...patient,
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [], notizen: [], verbleib: [], abgleiche: [],
    } as PersonDetail;
    render(einsatzAktiv, [patient]);
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)));
    await userEvent.click(await screen.findByRole('tab', { name: 'Alle' }));
    await userEvent.click(await screen.findByText('R-001'));
    const tags = await screen.findAllByText('Patient');
    expect(tags.length).toBeGreaterThan(0);
  });

  it('Detail-Drawer zeigt KEIN „Patient"-Tag bei unverletzter Person', async () => {
    const unverletztPerson = { ...person, status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const, aktuelle_sichtung_at: '2026-05-27 10:00:00' };
    const detail = {
      ...unverletztPerson,
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [], notizen: [], verbleib: [], abgleiche: [],
    } as PersonDetail;
    render(einsatzAktiv, [unverletztPerson]);
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)));
    await userEvent.click(await screen.findByRole('tab', { name: 'Alle' }));
    await userEvent.click(await screen.findByText('R-001'));
    // Drawer offen (Stammdaten sichtbar), aber kein Patient-Tag:
    expect(await screen.findByText('Stammdaten')).toBeInTheDocument();
    expect(screen.queryByText('Patient')).not.toBeInTheDocument();
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

  it('zeigt den „Als Geschädigte bei Schäden"-Block im Personen-Drawer', async () => {
    const detail = { ...person, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [], notizen: [], verbleib: [], abgleiche: [] } as PersonDetail;
    server.use(
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)),
    );
    render(einsatzAktiv, [person]);
    // Schäden-Handler nach render() einsetzen, damit er Vorrang gegenüber dem
    // Default-Fallback aus render() hat (MSW-Prepend-Semantik).
    server.use(
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        // Nur der Cross-Modul-Fetch trägt geschaedigt_person_id.
        if (url.searchParams.get('geschaedigt_person_id') === '10') {
          return HttpResponse.json([{
            id: 7, einsatz_id: 1, registrier_nr: 3, status: 'offen', typ: 'umweltschaden',
            ausmass: 'mittel', ort: 'Hauptstr. 1', beschreibung: '', geschaedigt_person_id: 10,
            geschaedigt_kontakt: null, uebergeben_an: null, uebergeben_at: null,
            abschluss_grund: null, abschluss_at: null, erfasst_at: '2026-05-29 10:00:00',
            erfasst_von: 1, geaendert_at: '2026-05-29 10:00:00', geaendert_von: 1,
            storniert_at: null, storniert_von: null, geschaedigt_registrier_nr: null,
            geschaedigt_storniert_at: null,
          }]);
        }
        return HttpResponse.json([]);
      }),
    );
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    expect(await screen.findByText(/Als Geschädigte bei Schäden/i)).toBeInTheDocument();
    expect(await screen.findByText((t) => t.includes('S-003'))).toBeInTheDocument();
  });
});
