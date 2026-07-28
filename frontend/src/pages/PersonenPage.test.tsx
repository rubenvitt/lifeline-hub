import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { setzeViewportBreite } from '../test/viewport';
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

/**
 * Zeilenfolge der Registriernummern in Dokumentordnung.
 *
 * Warum die FOLGE und nicht ein gerenderter Zeitstring: `renderMitProviders` hängt keinen
 * `EinsatzAnzeigeProvider` ein, `useAnzeigeKonventionen` fällt also auf Lokalzeit zurück —
 * eine Behauptung über „271100MAI2026" prüfte die Zeitzone des Testrechners. Die Folge ist
 * ohnehin genau das, was „sortierbar" behauptet.
 *
 * `getAllByText` vergleicht nur DIREKTE Textkinder, deshalb liefert die verschachtelte
 * Titelzelle (`<a><span><strong>R-001</strong></span></a>`) genau einen Treffer je Zeile.
 */
function regFolge(): string[] {
  return screen.getAllByText(/^R-\d{3}$/).map((e) => e.textContent ?? '');
}

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
    // Zwei belegte Gruppen mit je einem Patienten. Die Gruppenachse erscheint im
    // Tabellenzweig als Zählerstreifen der Werkzeugzeile („SK II · 1"), NICHT als
    // Zwischenkopfzeile — synthetische Gruppenzeilen sind bei unbedingt fixierter Spalte 0
    // ungeprüft (API-Entscheidung §9.8).
    expect(screen.getByText('SK II · 1')).toBeInTheDocument();
    expect(screen.getByText('tot · 1')).toBeInTheDocument();
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

  it('sortiert die Liste selbst, statt die Lieferreihenfolge zu übernehmen', async () => {
    // Die Fixture liegt ABSICHTLICH verdreht: das Backend liefert `ORDER BY registrier_nr`
    // aufsteigend (`src/person/repo.rs`), msw gibt das Array unverändert heraus. Eine in
    // Backend-Reihenfolge gelieferte Fixture wäre auch ohne eine Zeile Sortiercode grün.
    const drei = [
      { ...person, id: 30, registrier_nr: 3, status: 'betroffen' as const },
      { ...person, id: 31, registrier_nr: 1 },
      { ...person, id: 32, registrier_nr: 2, status: 'vermisst' as const },
    ];
    render(einsatzAktiv, drei);
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    expect(regFolge()).toEqual(['R-001', 'R-002', 'R-003']);
  });

  it('zeigt „seit" und ordnet Patienten derselben SK ältester-zuerst', async () => {
    /**
     * FALLE, gemessen: alle Bestandsfixtures sind aus `person` gespreizt und teilen
     * `erfasst_at: '2026-05-27 09:00:00'`. Eine Zeitsortier-Behauptung über gleiche
     * Zeitstempel ist eine Attrappe — diese beiden Personen tragen deshalb VERSCHIEDENE
     * Sichtungszeitpunkte, und die spätere wird zuerst geliefert.
     */
    const spaet = { ...person, id: 40, registrier_nr: 8, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const frueh = { ...person, id: 41, registrier_nr: 9, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:10:00' };
    render(einsatzAktiv, [spaet, frueh]);
    // Auf den REITER warten, nicht auf eine Zeile: beide Personen sind `betroffen` und
    // damit im Vorgabe-Reiter „Neu" unsichtbar.
    await userEvent.click(await screen.findByRole('tab', { name: 'Patienten' }));
    await vi.waitFor(() => expect(regFolge()).toHaveLength(2));
    // Die Spalte existiert überhaupt …
    expect(screen.getByRole('columnheader', { name: /seit/ })).toBeInTheDocument();
    // … und trägt eine taktische DTG (Muster, kein Fixwert — Lokalzeit des Testrechners) …
    const dtg = screen
      .getAllByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/)
      .map((e) => e.textContent);
    expect(dtg).toHaveLength(2);
    // … mit ZWEI VERSCHIEDENEN Werten: beide Fixtures teilen `erfasst_at` und `geaendert_at`,
    // also blieb ein `render` auf einem dieser Felder grün, solange nur das Format geprüft
    // wurde. Nur der Sichtungszeitpunkt unterscheidet sie.
    expect(new Set(dtg).size).toBe(2);
    // … und die ältere Sichtung steht oben, obwohl die jüngere zuerst geliefert wurde.
    expect(regFolge()).toEqual(['R-009', 'R-008']);
  });

  it('gibt nur BELEGTEN SK-Gruppen einen Zähler', async () => {
    const sk2 = { ...person, id: 50, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const tot = { ...person, id: 51, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    render(einsatzAktiv, [sk2, tot]);
    // Reiter statt Zeile abwarten: beide Personen sind im Vorgabe-Reiter „Neu" unsichtbar.
    await userEvent.click(await screen.findByRole('tab', { name: 'Patienten' }));
    expect(await screen.findByText('SK II · 1')).toBeInTheDocument();
    expect(screen.getByText('tot · 1')).toBeInTheDocument();
    /**
     * Die tragende Hälfte: SK I, III und IV stehen in der festen Gruppenfolge, haben aber
     * keine Zeile. Emittierte `gruppiere` sie mit Zähler 0, zöge hier lautlos ein
     * „SK I · 0" ein — das ist die Regel, die `PersonenPage` vorher per
     * `if (gruppe.length === 0) return null` selbst hielt. `^`-Anker, weil „SK I" sonst in
     * „SK II" matcht.
     */
    expect(screen.queryByText(/^SK I · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^SK III · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^SK IV · /)).not.toBeInTheDocument();
  });

  it('trägt „seit" in den Kartenzweig und ersetzt dort die Abgleich-Zelle durch einen Dialog', async () => {
    /**
     * Zwei Aussagen in einem Fall, weil sie denselben Zweig brauchen:
     *
     * 1. Unter `md` rendert `Datensicht` genau einen ANDEREN Zweig, und die Zeit kommt dort
     *    aus dem `sekundaer`-Tupel. Ein dort fehlender Slot wäre in jeder Tabellenprüfung
     *    unsichtbar.
     * 2. Die Abgleichspalte trägt ein 200 px breites, ~24 px hohes Auswahlfeld in der Zelle.
     *    Auf einer 390-px-Karte ist das nicht bedienbar; der Aktions-Deskriptor ERSETZT es
     *    durch einen Knopf plus Dialog. Ohne diesen Fall wäre die Ersetzung eine Behauptung.
     *
     * Breite VOR dem Rendern setzen: antds Beobachter liest beim Abonnieren synchron.
     */
    setzeViewportBreite(390);
    const gefunden = { ...person, id: 20, registrier_nr: 7, status: 'betroffen' as const };
    const schmal = render(einsatzAktiv, [unbekannt, gefunden]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    await screen.findByRole('region', { name: 'Personen' });
    // Genau EIN Zweig im Baum.
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    // Etikett UND Wert — das Etikett ist der zweite Kanal der Karte.
    expect(screen.getByText('seit')).toBeInTheDocument();
    expect(
      screen.getByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/),
    ).toBeInTheDocument();
    // Das Tastaturziel der Zeile ist der Titel-Link, nicht die Kartenfläche.
    expect(screen.getByRole('link', { name: 'R-002' })).toHaveAttribute(
      'href',
      '/einsaetze/1/personen/11',
    );
    // Und die Primäraktion führt in den Dialog statt in eine 24-px-Zelle.
    await userEvent.click(screen.getByRole('button', { name: /Abgleich vorschlagen/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('R-002');
    expect(screen.getByRole('combobox', { name: 'gefundene Person' })).toBeInTheDocument();
  });

  it('navigiert beim Klick auf eine Zeile zur Detailseite', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person]);
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    // Detailseite zeigt den Personen-Titel als Heading:
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
  });
});
