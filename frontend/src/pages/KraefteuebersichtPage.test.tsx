import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import KraefteuebersichtPage, { aktiveFilterChips, LEERER_FILTER } from './KraefteuebersichtPage';
import { Routes, Route } from 'react-router';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { EinsatzAnzeige } from '../api/types';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn() }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));
vi.mock('../api/einsatzMaterial', () => ({ listeEinsatzMaterial: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
// Der frühere `vi.mock('../live/useEinsatzLiveStream')` ist entfallen: die Seite importiert
// den Hook nicht (0 Treffer). Die Aussage dahinter — diese Fläche hat KEINEN eigenen
// Stream, sie hängt an den sechs Queries oben — steht jetzt am Zufluss-Kommentar der Seite.
vi.mock('../api/lageberichte', () => ({
  legeLageberichtAn: vi.fn(() => Promise.resolve({ id: 99 })),
  aktualisiereLagebericht: vi.fn(() => Promise.resolve({})),
}));
vi.mock('react-router', async (orig) => ({ ...(await orig()), useNavigate: () => vi.fn() }));

// Nur die im Page genutzten Felder; Rest via Cast (Test-Fixture, kein echter Server-DTO).
const EINSATZ = { id: 1, bezeichnung: 'Testeinsatz', status: 'aktiv', meine_rolle: 'einsatzleitung' } as EinsatzAnzeige;

const PERSON_P1 = {
  id: 1, einsatz_id: 1, personal_id: null, einheit_id: null, fahrzeug_id: null, ist_adhoc: false,
  name: 'P1', funktion: null, traegerorganisation: null,
  staerke_position: 'mannschaft' as const, status_id: null,
  status_label: null, status_kategorie: 'gebunden' as const,
  status_farbe: null, bemerkung: null,
  disponiert_at: '2024-01-01T00:00:00', disponiert_von: null,
};

const ABSCHNITT_A1 = {
  id: 10, einsatz_id: 1, ueber_abschnitt_id: null,
  name: 'Abschnitt Nord',
  leiter_id: null, leiter_name: null, bemerkung: null, sortier: 1,
  flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
  sprechgruppe_tmo: null, sprechgruppe_dmo: null, kommunikationsmittel: null, erreichbarkeit: null,
  sprechgruppen: [],
};

const EINHEIT_E10 = {
  id: 20, einsatz_id: 1, abschnitt_id: 10, abschnitt_name: 'Abschnitt Nord',
  ueber_einheit_id: null, typ_id: null, typ_label: null,
  name: '1. Zug', fuehrer_id: null, fuehrer_name: null,
  bemerkung: null, sortier: 1,
  soll: null,
  ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
  lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null,
  aktueller_br_id: null,
  sprechgruppen: [],
};

const FAHRZEUG_F1 = {
  id: 30, einsatz_id: 1, fahrzeug_id: null, einheit_id: 20,
  ist_adhoc: false, funkrufname: 'FW 1/44-1', kennzeichen: null,
  fahrzeugtyp: 'HLF 20', opta: null, traegerorganisation: null,
  status_id: null, status_label: null,
  status_kategorie: 'verfuegbar' as const,
  status_farbe: null, bemerkung: null,
  disponiert_at: '2024-01-01T00:00:00', disponiert_von: null,
  lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null,
  aktueller_br_id: null, soll_besatzung: null,
};

let drucke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  drucke = vi.fn();
  vi.stubGlobal('print', drucke);
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(listeEinheiten).mockResolvedValue([]);
  vi.mocked(listeEinsatzPersonal).mockResolvedValue([]);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([]);
  vi.mocked(listeEinsatzMaterial).mockResolvedValue([]);
  vi.mocked(listeAbschnitte).mockResolvedValue([]);
});

/**
 * Auf `renderMitProviders` gehoben (vorher rohes `render` mit selbstgebauten Providern,
 * OHNE `ConfigProvider`). Ohne ihn ist jede Aussage über einen Zweig oder über die
 * Dichte-/Höhenachse von `Datensicht` unerreichbar, weil `theme.useToken()` dann auf
 * antd-Defaults statt auf die Anwendungskonfiguration fällt. Die eigene
 * `AuthProvider`-Schachtel entfällt — `renderMitProviders` bringt sie mit, zweimal
 * verschachtelt lädt sie zweimal.
 */
function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/kraefteuebersicht" element={<KraefteuebersichtPage />} />
    </Routes>,
    { route: '/einsaetze/1/kraefteuebersicht' },
  );
}

/** Fixture mit Abschnitt → Einheit → Fahrzeug, also allen drei Zeilenarten. */
function mitBaum() {
  vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
  vi.mocked(listeEinheiten).mockResolvedValue([EINHEIT_E10]);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([FAHRZEUG_F1]);
}

describe('KraefteuebersichtPage', () => {
  it('zeigt einen Druck-Button', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /Drucken/i })).toBeInTheDocument();
  });

  it('zeigt Titel und die Gesamt-Personalstärke im Kopf', async () => {
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();
    expect(await screen.findByRole('heading', { name: 'Kräfteübersicht' })).toBeInTheDocument();
    const statCard = screen.getByText('Gesamtstärke (F/UF/M//Ges)').closest('.ant-statistic')!;
    expect(await within(statCard as HTMLElement).findByText('0/0/1//1')).toBeInTheDocument();
  });

  it('rendert Abschnitt, Einheit und Einzelmittel als aufklappbare Zeilen', async () => {
    mitBaum();
    const { container } = setup();
    /**
     * Seit LFH-338 · C3 startet das Blatt AUFGEKLAPPT (H7) — alle drei Zeilenarten stehen
     * ohne Zutun da. Der frühere Weg über `.ant-table-row-expand-icon-collapsed` fand nach
     * dem Umbau nichts mehr; die Aussage („alle drei Ebenen erreichbar") bleibt dieselbe,
     * nur die Reihenfolge dreht sich: erst sichtbar, dann zuklappbar.
     */
    expect(await screen.findByText('Abschnitt Nord')).toBeInTheDocument();
    expect(screen.getByText('1. Zug')).toBeInTheDocument();
    expect(screen.getByText('FW 1/44-1')).toBeInTheDocument();

    // Und sie bleiben aufklappBAR: das Symbol steht da und trägt jetzt den Auf-Zustand.
    expect(container.querySelector('.ant-table-row-expand-icon-expanded')).not.toBeNull();
  });

  it('zeigt Fahrzeug-Verfügbarkeits-Achse im Kopf', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([FAHRZEUG_F1]);
    setup();
    /**
     * Seit LFH-338 · C3 steht die Verteilung als EINE Zeile unter der Fahrzeug-Kachel statt
     * als drei gleichrangige `Statistic` daneben (Befund H6: bis zu 12 Kacheln in einer
     * nicht umbrechenden Reihe). Die Aussage bleibt dieselbe — die Zahl der freien
     * Fahrzeuge ist im Kopf ablesbar —, nur ihre Form ist kompakter.
     *
     * Der Wortlaut trägt weiterhin die Bedeutung: Farbe allein reicht nicht
     * (Prüflisten-Kriterium 6), deshalb wird auf „1 frei" geprüft und nicht auf eine Farbe.
     */
    expect(await screen.findByText('1 frei')).toBeInTheDocument();
    expect(screen.getByText('0 gebunden')).toBeInTheDocument();
    expect(screen.getByText('0 n. einsatzbereit')).toBeInTheDocument();
  });

  it('zeigt Filterleiste mit Trägerorganisation-Select', async () => {
    setup();
    // Filter bar renders after einsatzQuery resolves past the Spin early-return
    expect(await screen.findByText('Trägerorganisation')).toBeInTheDocument();
  });

  it('zeigt "In Lagebericht übernehmen" nur für Führungspersonal im aktiven Einsatz', async () => {
    // EINSATZ hat status:'aktiv' und meine_rolle:'einsatzleitung' → Button sichtbar
    setup();
    expect(await screen.findByRole('button', { name: /In Lagebericht übernehmen/i })).toBeInTheDocument();
  });

  it('versteckt "In Lagebericht übernehmen" für Beobachter', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' } as EinsatzAnzeige);
    setup();
    // Wait for page to render past Spin
    await screen.findByRole('button', { name: /Drucken/i });
    expect(screen.queryByRole('button', { name: /In Lagebericht übernehmen/i })).toBeNull();
  });

  it('ruft legeLageberichtAn und aktualisiereLagebericht beim Klick auf Übernahme-Button auf', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /In Lagebericht übernehmen/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ vorlage: 'freitext' }),
      ),
    );
    await waitFor(() =>
      expect(vi.mocked(aktualisiereLagebericht)).toHaveBeenCalledWith(
        1,
        99,
        expect.objectContaining({
          abschnitte: expect.arrayContaining([
            expect.objectContaining({ schluessel: 'text' }),
          ]),
        }),
      ),
    );
  });

  // ── Teil 2: die Ampelzeile als zwei eigene Spalten ──────────────────────────────

  it('zeigt Personal und Fahrzeuge als eigene Spalten mit Textkopf', async () => {
    /**
     * Vorher: eine 220-px-Statusspalte mit bis zu acht `Tag` und zwei Emoji als einziger
     * Achsenunterscheidung. „Personal"/„Fahrzeuge" existierten nur als `Statistic title`
     * im Kennzahlenkopf, und antd rendert die in einem `div` OHNE Rolle — diese Abfrage
     * kann also nicht aus der falschen Richtung grün werden.
     */
    mitBaum();
    setup();
    await screen.findByText('Abschnitt Nord');
    expect(screen.getByRole('columnheader', { name: 'Personal' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fahrzeuge' })).toBeInTheDocument();
  });

  it('die Zählgruppen einer Abschnittszeile sind über ihr Etikett erreichbar und tragen Kurztexte', async () => {
    /**
     * `within(zeile)` ist PFLICHT, nicht Kosmetik: die Fixture hat mit Abschnitt UND
     * Einheit zwei Zeilen mit Zählgruppen, und nur weil `expandedRowKeys` leer startet,
     * existiert zufällig genau ein Knoten. Ungescopet würde diese Abfrage beim ersten
     * zweiten Abschnitt oder beim ersten Aufklapp-Klick mit einer
     * Mehrfachtreffer-Verletzung werfen — grün aus dem falschen Grund.
     */
    mitBaum();
    const { container } = setup();
    await screen.findByText('Abschnitt Nord');
    const zeile = container.querySelector('[data-row-key="ab-10"]') as HTMLElement;
    expect(zeile).not.toBeNull();

    const personal = within(zeile).getByLabelText('Personal');
    // Der Kurztext IST der zweite Kanal (Kriterium 6): die Farbe färbt nur die Zahl.
    expect(personal).toHaveTextContent('frei');
    expect(personal).toHaveTextContent('n.v.');

    const fahrzeuge = within(zeile).getByLabelText('Fahrzeuge');
    // Ein verfügbares Fahrzeug im Abschnitt, über die Einheit kumuliert.
    expect(within(fahrzeuge).getByTitle('verfügbar')).toHaveTextContent('1');
    // Und die 0 steht MIT da — sonst fluchten zwei Zeilen nicht übereinander.
    expect(within(fahrzeuge).getByTitle('gebunden')).toHaveTextContent('0');
  });

  it('die Statusspalte trägt nur noch den Einzelstatus der Mittel', async () => {
    mitBaum();
    const { container } = setup();
    // Seit LFH-338 · C3 steht die Mittelzeile ohne Durchklappen da (H7): das Blatt startet
    // aufgeklappt. Die beiden früheren Klicks auf die Aufklapp-Symbole sind entfallen.
    await screen.findByText('FW 1/44-1');

    const mittel = container.querySelector('[data-row-key="ef-30"]') as HTMLElement;
    expect(within(mittel).getByText('verfügbar')).toBeInTheDocument();
    // Und umgekehrt: die Aggregatzeilen tragen ihre Zahlen NICHT mehr in der Statusspalte,
    // sondern in den zwei eigenen Spalten — dort steht kein Kurztext.
    const abschnitt = container.querySelector('[data-row-key="ab-10"]') as HTMLElement;
    const statusZelle = abschnitt.querySelectorAll('td')[5];
    expect(statusZelle.textContent).toBe('');
  });

  it('die Statusfilter-Optionen kommen aus der einen Statusachse — ohne den vierten Eimer', async () => {
    /**
     * Die drei Optionen standen hier als Literale und waren die dritte Kopie derselben
     * Labels. Sie kommen jetzt aus `KATEGORIE_WERTE`.
     *
     * Der vierte Eimer („ohne Status") bleibt draußen, und das ist eine Entscheidung:
     * `FilterWerte.kategorie` ist `StatusKategorie | null`, und `filtereKraefte` vergleicht
     * `kat === f.kategorie` — ein Filterwert `'ohne'` träfe also NIE eine Zeile und wäre
     * eine tote Option. Gruppieren nach vier Eimern (Fahrzeuge/Personal) und Filtern nach
     * drei ist hier kein Widerspruch, sondern die Grenze der Datenschicht.
     */
    const { container } = setup();
    await screen.findByText('Trägerorganisation');
    // Auf die Filter-Card scopen: „Status" ist auch ein Spaltenkopf, ungescopet ist die
    // Abfrage mehrdeutig. Und NICHT über die Position im DOM — ein zusätzliches Feld in
    // der Leiste würde einen Positionsindex lautlos verschieben.
    const karte = container.querySelector('.kraefte-no-print.ant-card') as HTMLElement;
    expect(karte, 'Filter-Card nicht gefunden').not.toBeNull();
    const statusFilter = [...karte.querySelectorAll('.ant-select')].find((s) =>
      s.textContent?.includes('Status'),
    );
    expect(statusFilter, 'Status-Select nicht gefunden').not.toBeUndefined();
    // antd 6 nennt die Klickfläche `.ant-select-content` (v5: `.ant-select-selector`) und
    // den Platzhalter `.ant-select-placeholder` — nachgemessen, nicht aus dem Gedächtnis.
    fireEvent.mouseDown(statusFilter!.querySelector('.ant-select-content')!);
    const optionen = await waitFor(() => {
      const treffer = document.querySelectorAll('.ant-select-item-option-content');
      expect(treffer.length).toBeGreaterThan(0);
      return [...treffer].map((o) => o.textContent);
    });
    expect(optionen).toEqual(['verfügbar', 'gebunden', 'nicht verfügbar']);
  });

  // ── Teil 3: das Meldebild auf dem Primitiv ──────────────────────────────────────

  it('der Meldebild-Baum bleibt AUCH bei 390 px eine Tabelle', async () => {
    /**
     * Prüflisten-Kriterium 14: „keine Auflösung in Karten, wo verglichen wird". Die
     * Bedien-Leitlinie führt genau diese Seite als kanonisches „wird verglichen: ja",
     * deshalb `form="tabelle"` und kein Kartenzweig. Ohne diese Zusicherung wäre ein
     * `form="auto"` hier unauffällig — die Breit-Ansicht sähe identisch aus.
     */
    setzeViewportBreite(390);
    mitBaum();
    const { container } = setup();
    await screen.findByText('Abschnitt Nord');
    expect(container.querySelector('.ant-table')).not.toBeNull();
    // Gegenprobe zur Formwahl: kein Kartenzweig daneben (genau EIN Zweig im Baum).
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).toBeNull();
  });

  it('Drucken klappt alle Knoten auf und druckt genau einmal', async () => {
    /**
     * Der Aufklappzustand liegt beim AUFRUFER, nicht im Primitiv — genau deswegen: hier
     * setzt ihn ein anderes Seitenmerkmal (`handleDrucken`), und gedruckt wird erst im
     * Folgeeffekt. Ein Primitiv mit internem Aufklappzustand hätte diesen Pfad lautlos
     * stillgelegt: kein Fehler, kein roter Test, nur ein Ausdruck mit kollabierten Zeilen.
     */
    mitBaum();
    setup();
    // Seit LFH-338 · C3 startet das Blatt aufgeklappt (H7). Für DIESE Zusicherung wird
    // deshalb erst von Hand zugeklappt — sonst wäre „Drucken klappt auf" trivial erfüllt
    // und der Pfad, um den es geht, ungeprüft.
    await screen.findByText('FW 1/44-1');
    fireEvent.click(screen.getByText('Nur Abschnitte'));
    await waitFor(() => expect(screen.queryByText('1. Zug')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Drucken/i }));

    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    expect(screen.getByText('FW 1/44-1')).toBeInTheDocument();
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
  });

  it('„Drucken" bleibt AUSSERHALB der Werkzeugzeile des Primitivs', async () => {
    /**
     * Abweichung von der API-Spec §6, begründet: `kraefteuebersichtPrint.css` arbeitet über
     * `body * { visibility: hidden }` plus `.kraefte-no-print { display: none }`. Ein Knoten
     * INNERHALB von `Datensicht` ist damit nicht markierbar — `DatensichtProps` nimmt kein
     * `className`. In `werkzeuge` läge der Druckknopf also im Ausdruck.
     */
    mitBaum();
    const { container } = setup();
    await screen.findByText('Abschnitt Nord');
    const werkzeuge = container.querySelector('[data-lfh="datensicht-werkzeuge"]') as HTMLElement;
    expect(werkzeuge).not.toBeNull();
    expect(within(werkzeuge).queryByRole('button', { name: /Drucken/i })).toBeNull();
    // Was dort steht, ist der Spaltenschalter — und nur er.
    expect(within(werkzeuge).getByRole('button', { name: /Spalten/ })).toBeInTheDocument();
    expect(werkzeuge.childElementCount).toBe(1);
  });

  it('der Druck neutralisiert Bildlaufcontainer, Sticky-Kopf, fixierte Spalte und Werkzeugzeile', () => {
    /**
     * jsdom rechnet kein Layout und `@media print` schon gar nicht — diese Zusicherung ist
     * bewusst eine TEXT-Prüfung der Regeldatei, kein Layoutbeweis. Sie steht hier, weil der
     * Umbau auf `KatalogTabelle` einen `overflow: auto`-Container, einen Sticky-Holder und
     * `position: sticky` an Spalte 0 einführt, die das alte Blatt (nur `visibility`) nicht
     * kennt: der Ausdruck wäre rechts abgeschnitten, und JEDER Vitest bliebe grün.
     * Der Layoutbeweis gehört nach `frontend/e2e/` (Bildlaufmaß unter `emulateMedia`).
     */
    const hier = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(hier, 'kraefteuebersichtPrint.css'), 'utf-8');
    const druckblock = css.slice(css.indexOf('@media print'));
    for (const marke of [
      '.ant-table-body',
      '.ant-table-sticky-holder',
      '.ant-table-cell-fix-start',
      '[data-lfh="datensicht-werkzeuge"]',
    ]) {
      expect(druckblock, `Druckregel für ${marke} fehlt`).toContain(marke);
    }
    expect(druckblock).toMatch(/overflow:\s*visible\s*!important/);
  });
});

/**
 * ── FILTERWAHRHEIT IM KOPF (LFH-338 · C3, Befund H3) ────────────────────────────
 *
 * Die Kopfzahlen wurden schon immer aus den GEFILTERTEN Daten gerechnet, die Kachel war
 * aber unverändert mit „Gesamtstärke" beschriftet. Wer im Fükw kurz weggeht, zurückkommt
 * und abliest, meldete damit die Teilstärke eines Abschnitts als Gesamtstärke des
 * Einsatzes — eine Falschmeldung an die übergeordnete Führungsstelle.
 *
 * Die Selects werden über `getAllByRole('combobox')` mit Index gegriffen (Bestandsmuster
 * aus `SchaedenPage.test.tsx:158`): die vier Filterfelder tragen nur Platzhalter, keine
 * Beschriftungen — ein `name`-Matcher hätte hier nichts zu greifen.
 */
async function waehleAbschnitt(name: string) {
  const felder = screen.getAllByRole('combobox');
  fireEvent.mouseDown(felder[0]); // 0 = Abschnitt, 1 = Trägerorganisation, 2 = Status
  fireEvent.click(await screen.findByTitle(name));
}

describe('KraefteuebersichtPage — Filterwahrheit', () => {
  it('nennt den Kopf ungefiltert „Gesamtstärke" und mit Filter nicht mehr so', async () => {
    mitBaum();
    setup();
    expect(await screen.findByText(/Gesamtstärke/)).toBeInTheDocument();

    await waehleAbschnitt('Abschnitt Nord');

    await waitFor(() => expect(screen.queryByText(/Gesamtstärke/)).toBeNull());
    expect(screen.getByText(/Stärke \(gefiltert/)).toBeInTheDocument();
  });

  it('zeigt „X von Y Kräften" und setzt mit einem Klick alle Filter zurück', async () => {
    // P1 hängt an KEINER Einheit, F1 an Einheit 20 (Abschnitt Nord). Der Abschnittsfilter
    // trennt die beiden also — sonst wäre „X von Y" mit X = Y trivial erfüllt.
    vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
    vi.mocked(listeEinheiten).mockResolvedValue([EINHEIT_E10]);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([FAHRZEUG_F1]);
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();

    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();

    await waehleAbschnitt('Abschnitt Nord');
    expect(await screen.findByText('1 von 2 Kräften')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();
    // Und der Titel ist wieder der ungefilterte — das Zurücksetzen wirkt auf den ganzen Kopf.
    expect(screen.getByText(/Gesamtstärke/)).toBeInTheDocument();
  });

  it('führt die ungefilterte Gesamtstärke als Bezugswert weiter, sobald gefiltert wird', async () => {
    vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
    vi.mocked(listeEinheiten).mockResolvedValue([EINHEIT_E10]);
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]); // 0/0/1//1, ohne Einheit
    setup();
    await screen.findByText(/Gesamtstärke/);

    await waehleAbschnitt('Abschnitt Nord');

    // Gefiltert bleibt niemand übrig — der Bezugswert steht trotzdem da. Genau das ist der
    // Punkt: eine leere gefilterte Menge darf die Gesamtstärke nicht verschwinden lassen.
    expect(await screen.findByText(/ungefiltert 0\/0\/1\/\/1/)).toBeInTheDocument();
  });

  it('zeigt den gesetzten Filter als schließbare Marke, die genau ihn zurücknimmt', async () => {
    vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
    vi.mocked(listeEinheiten).mockResolvedValue([EINHEIT_E10]);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([FAHRZEUG_F1]);
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();
    await screen.findByText('2 von 2 Kräften');

    await waehleAbschnitt('Abschnitt Nord');
    const marke = await screen.findByText('Abschnitt: Abschnitt Nord');
    expect(marke).toBeInTheDocument();

    // Das Schließkreuz der Marke, nicht der Zurücksetzen-Knopf.
    fireEvent.click(marke.closest('.ant-tag')!.querySelector('.ant-tag-close-icon')!);
    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();
    expect(screen.queryByText('Abschnitt: Abschnitt Nord')).toBeNull();
  });
});

describe('aktiveFilterChips', () => {
  const name = () => 'Abschnitt Nord';

  it('ist leer, solange nichts gesetzt ist', () => {
    expect(aktiveFilterChips(LEERER_FILTER, name)).toEqual([]);
  });

  it('führt jeden gesetzten Filter mit sprechendem Etikett, in fester Reihenfolge', () => {
    const chips = aktiveFilterChips(
      { abschnittId: 10, traeger: 'FF Musterstadt', kategorie: 'verfuegbar', suche: '  HLF  ' },
      name,
    );
    expect(chips.map((c) => c.label)).toEqual([
      'Abschnitt: Abschnitt Nord',
      'Träger: FF Musterstadt',
      'Status: verfügbar',
      'Suche: „HLF"',
    ]);
    expect(chips.map((c) => c.schluessel)).toEqual(['abschnittId', 'traeger', 'kategorie', 'suche']);
  });

  it('wertet eine Suche aus lauter Leerzeichen NICHT als gesetzten Filter', () => {
    // `filtereKraefte` trimmt ebenfalls (`f.suche.trim()`); eine Marke für einen Filter, der
    // nichts filtert, behauptete eine Einschränkung, die es nicht gibt.
    expect(aktiveFilterChips({ ...LEERER_FILTER, suche: '   ' }, name)).toEqual([]);
  });
});

/**
 * ── DAS GEDRUCKTE MELDEBLATT (LFH-338 · C3, Befund H4) ──────────────────────────
 *
 * Der Ausdruck ging bis dahin ohne Einsatzbezug, ohne Zeitstand und ohne Angabe der Auswahl
 * an die übergeordnete Führungsstelle: die Bezeichnung stand ausschließlich in der
 * Breadcrumb, und die trägt `.kraefte-no-print`.
 *
 * Der Knoten wird über `data-testid` gegriffen, nicht über seine Sichtbarkeit: jsdom wertet
 * kein CSS aus, ein `toBeVisible()` könnte Schirm- und Druckzweig hier gar nicht
 * unterscheiden. Dass er am Schirm verborgen ist, prüft die CSS-Textzusicherung unten.
 */
describe('KraefteuebersichtPage — Druckkopf', () => {
  it('trägt Einsatzbezeichnung, taktischen Zeitstand und Ersteller', async () => {
    mitBaum();
    setup();
    const kopf = await screen.findByTestId('kraefte-druckkopf');
    expect(within(kopf).getByText(/Testeinsatz/)).toBeInTheDocument();
    // Taktische DTG: DDHHmm + dreibuchstabiges Monatskürzel + Jahr, z. B. 111430AUG2026.
    expect(within(kopf).getByText(/Stand: \d{6}[A-ZÄÖÜ]{3}\d{4}/)).toBeInTheDocument();
    expect(within(kopf).getByText(/Erstellt von:/)).toBeInTheDocument();
  });

  it('nennt die Auswahl im Druckkopf, sobald gefiltert wird — und sonst nicht', async () => {
    mitBaum();
    setup();
    const kopf = await screen.findByTestId('kraefte-druckkopf');
    expect(within(kopf).queryByText(/^Auswahl:/)).toBeNull();

    await waehleAbschnitt('Abschnitt Nord');

    expect(await within(kopf).findByText('Auswahl: Abschnitt: Abschnitt Nord')).toBeInTheDocument();
  });

  it('verbirgt den Druckkopf am Schirm und wiederholt im Druck die Spaltenköpfe', () => {
    const hier = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(hier, 'kraefteuebersichtPrint.css'), 'utf-8');
    const druckblock = css.slice(css.indexOf('@media print'));
    const schirmblock = css.slice(0, css.indexOf('@media print'));

    // Am Schirm weg — und zwar AUSSERHALB des Druckblocks, sonst wäre er überall sichtbar.
    expect(schirmblock).toMatch(/\.kraefte-nur-print\s*\{[^}]*display:\s*none/);
    expect(druckblock).toMatch(/\.kraefte-nur-print\s*\{[^}]*display:\s*block/);

    // Mehrseitige Bäume: Kopfzeile je Blatt, keine Zeile über den Blattrand.
    expect(druckblock).toMatch(/thead\s*\{[^}]*display:\s*table-header-group/);
    expect(druckblock).toMatch(/tr\s*\{[^}]*break-inside:\s*avoid/);
  });
});

/**
 * ── DER MONITORING-KOPF (LFH-338 · C3, Befund H6) ───────────────────────────────
 *
 * Bis dahin lagen bis zu 12 Kennzahlen in einem `Space` mit `flexWrap: 'nowrap'` hinter
 * einem Card-internen `overflowX: 'auto'`. Auf ~950 px nutzbarer Breite (13"-Fükw-Schirm)
 * lag die komplette Materialachse unsichtbar rechts — ohne jede optische Andeutung.
 *
 * jsdom rechnet kein Layout: der eigentliche Beweis („scrollt nicht waagerecht") steht in
 * `frontend/e2e/meldebild-tabelle.spec.ts`. Hier wird die STRUKTUR geprüft, aus der er
 * folgt, plus das Verschwinden der beiden Konstrukte im Quelltext — das ist wörtlich das
 * Akzeptanzkriterium des Tickets.
 */
describe('KraefteuebersichtPage — Kopf bricht um', () => {
  it('setzt den Kopf in ein Raster statt in eine nicht umbrechende Reihe', async () => {
    mitBaum();
    const { container } = setup();
    await screen.findByText(/Gesamtstärke/);
    expect(container.querySelector('.ant-row')).not.toBeNull();
  });

  it('zeigt alle drei Achsen — Personal, Fahrzeuge, Material', async () => {
    mitBaum();
    setup();
    expect(await screen.findByText(/Gesamtstärke/)).toBeInTheDocument();
    expect(screen.getByText('Fahrzeuge', { selector: '.ant-statistic-title' })).toBeInTheDocument();
    expect(screen.getByText(/Material \(Pos\.\)/)).toBeInTheDocument();
  });

  it('trägt weder flexWrap: nowrap noch einen Card-internen Horizontalscroll', () => {
    const hier = dirname(fileURLToPath(import.meta.url));
    const quelle = readFileSync(join(hier, 'KraefteuebersichtPage.tsx'), 'utf-8');
    expect(quelle).not.toMatch(/flexWrap:\s*'nowrap'/);
    expect(quelle).not.toMatch(/overflowX:\s*'auto'/);
  });
});

/**
 * ── DAS BLATT STARTET AUFGEKLAPPT (LFH-338 · C3, Befund H7) ─────────────────────
 *
 * Das Meldebild ist die Verdichtung, aus der gemeldet wird — und es öffnete vollständig
 * ZUgeklappt. Wer die Stärke eines Abschnitts ablesen wollte, klickte sich erst durch n
 * Ebenen, jedes Mal auf ein rund 16 px breites Symbol.
 */
describe('KraefteuebersichtPage — Aufklappen', () => {
  it('startet aufgeklappt, sobald der erste Baum geladen ist', async () => {
    mitBaum();
    setup();
    // Abschnitt → Einheit → Fahrzeug: die TIEFSTE Zeile steht ohne einen einzigen Klick da.
    expect(await screen.findByText('FW 1/44-1')).toBeInTheDocument();
  });

  it('klappt über „Nur Abschnitte" auf die oberste Ebene zurück und wieder auf', async () => {
    mitBaum();
    setup();
    await screen.findByText('FW 1/44-1');

    fireEvent.click(screen.getByText('Nur Abschnitte'));
    await waitFor(() => expect(screen.queryByText('FW 1/44-1')).toBeNull());
    // Die oberste Ebene bleibt — „zu" heißt nicht „leer".
    expect(screen.getByText('Abschnitt Nord')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Alles aufklappen'));
    expect(await screen.findByText('FW 1/44-1')).toBeInTheDocument();
  });

  it('klappt eine Zeile per Klick auf die Zeile zu, nicht nur am Symbol', async () => {
    mitBaum();
    setup();
    await screen.findByText('FW 1/44-1');

    // Auf den Text der Abschnittszeile, nicht auf das Aufklapp-Symbol.
    fireEvent.click(screen.getByText('Abschnitt Nord'));
    await waitFor(() => expect(screen.queryByText('FW 1/44-1')).toBeNull());
  });

  it('klappt eine vom Benutzer zugeklappte Zeile NICHT bei jedem Datenzufluss wieder auf', async () => {
    mitBaum();
    setup();
    await screen.findByText('FW 1/44-1');
    fireEvent.click(screen.getByText('Abschnitt Nord'));
    await waitFor(() => expect(screen.queryByText('FW 1/44-1')).toBeNull());

    /**
     * Das automatische Aufklappen darf GENAU EINMAL greifen. Ohne Riegel klappte jeder
     * Neuaufbau des Baums die Handarbeit der Einsatzkraft wieder auf — und der passiert
     * dauernd: `bild` hängt an sechs Queries UND am Filter, jeder Tastendruck im Suchfeld
     * baut ihn neu.
     *
     * Als Auslöser dient deshalb genau das: ein Suchbegriff, der die Fahrzeugzeile
     * ausdrücklich BEHÄLT ('FW' trifft ihren Funkrufnamen). Bliebe sie danach weg, weil sie
     * herausgefiltert wurde, bewiese der Test nichts über das Aufklappen. Der Druck-Knopf
     * taugt als Auslöser NICHT — der klappt absichtlich alles auf.
     */
    fireEvent.change(screen.getByPlaceholderText('Suche...'), { target: { value: 'FW' } });

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('FW 1/44-1')).toBeNull();
    // Gegenprobe: die Zeile ist zugeklappt, nicht weggefiltert — ihr Elternteil steht da.
    expect(screen.getByText('Abschnitt Nord')).toBeInTheDocument();
  });
});
