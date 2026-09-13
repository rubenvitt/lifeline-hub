import { expect, test, type Page, type Route } from '@playwright/test';
import type { EinsatzAnzeige } from '../src/api/types';

/**
 * Kriterium 12 der Prüfliste Einsatztauglichkeit („Kein Sprung unter dem Cursor"),
 * Spalte `EinsaetzePage` — LFH-514, Nachzug zu LFH-336 · C1.
 *
 * WARUM HIER UND NICHT IN VITEST: `vite.config.ts` fährt Vitest mit `css: false`, und
 * jsdom rechnet kein Layout. Belegt war bisher nur die STRUKTUR — Skelett und Karte
 * teilen denselben Rasterknoten und dieselbe `KACHEL_MIN_HOEHE` (`EinsaetzePage.test.tsx`,
 * „zeigt beim Laden Karten-Skelette im Raster"). Ein Layout-Shift ist eine Geometrie-
 * Aussage; sie lässt sich nur im Browser erheben. Die Prüfliste verwies dafür zuletzt auf
 * LFH-396 als „denselben Messtask" — das war eine Vermutung: LFH-396 misst
 * `boundingBox()`, keinen Shift.
 *
 * ── DER TRAGENDE BEFUND: EIN CLS-WERT ALLEIN IST HIER BLIND ──────────────────────────
 *
 * `layout-shift` meldet ausschließlich Elemente, die in ZWEI aufeinanderfolgenden Frames
 * existieren UND ihre Startposition ändern. Verschwindende Skelette und erscheinende
 * Karten sind für sich genommen KEIN Shift. Auf dieser Seite steht der Rasterknoten als
 * letztes Element des Ladezustands: die „Abgeschlossen"-Sektion hängt an
 * `abgeschlossene.length > 0` und existiert währenddessen gar nicht. Eine Höhenänderung
 * des Rasters verschiebt also NICHTS, was vorher schon dastand.
 *
 * GEMESSEN am 11.09.2026 mit einer Vorfassung dieses Specs, die NUR die Shift-Summe
 * zusicherte: mit halbierter Skeletthöhe (`KACHEL_MIN_HOEHE / 2` nur am `KachelSkelett`)
 * meldete Test 1 **exakt denselben** Wert 0.0022 wie ohne die Mutation — und blieb grün.
 * Ein Spec, der nur die Shift-Summe prüft, hätte `KACHEL_MIN_HOEHE` also nie geprüft,
 * während der Sprung eingebaut war.
 *
 * DESHALB TRÄGT TEST 1 ZWEI ZUSICHERUNGEN: die Shift-Summe (das, wonach Kriterium 12
 * fragt) UND den gemessenen Kachelboden in beiden Zuständen (das, was den Sprung
 * verhindert). Nur die zweite färbt die Mutationsprobe rot — siehe dort.
 *
 * ── WAS GEMESSEN WIRD ────────────────────────────────────────────────────────────────
 *
 *  1. Ladewechsel Skelett → Karten bei gleichbleibender Reihenzahl (Test 1), plus
 *     Kachelboden für Skelett- und Datenkachel.
 *  2. Ladewechsel ab `SUCHE_AB = 8` (Test 2) — hier ändert sich der Aufbau zweifach: das
 *     Suchfeld erscheint ÜBER dem Raster, und das Raster wächst von einer Skelettreihe auf
 *     drei Kartenreihen. Beide schieben denselben Knoten.
 *  3. Fensterfokus-Refetch mit unveränderten Daten (Test 3) — Review-Befund M5 zu
 *     LFH-336: `refetchOnWindowFocus` ist an `globalKeys.einsaetze()` nicht abgeschaltet,
 *     und die `begonnen_at`-desc-Sortierung könnte klickbare Karten umsortieren.
 *
 * ── SUMME IST NICHT GLEICH CLS (wichtig für die Lesart der Zahl) ─────────────────────
 *
 * web.dev definiert CLS als das GRÖSSTE Sitzungsfenster (Shifts im Abstand < 1 s, Fenster
 * höchstens 5 s lang). Gemessen wird hier die SUMME aller Shifts ohne `hadRecentInput`
 * über die Lebensdauer des Dokuments. Die Summe ist nie kleiner als das größte Fenster,
 * die Zusicherung also STRENGER als die Metrik — ein grüner Test hier bedeutet auch einen
 * grünen CLS. Der Spec behauptet deshalb keine CLS-Gleichheit, sondern die Obergrenze.
 *
 * ── WARUM `page.route` STATT SEEDING ─────────────────────────────────────────────────
 *
 * Ein Layout-Shift hängt an der ZAHL der Kacheln: das Raster ist bei 960 px Seitenbreite
 * (`flaeche.seiteBreit`) und 260 px Kachel-Mindestbreite (`flaeche.kachelMin`) drei
 * Spalten breit, drei Skelette füllen also genau eine Reihe. Die Suite legt in DERSELBEN
 * Datenbank parallel Einsätze an (`gate3-trefflaeche.spec.ts` sät acht, `kernfluss` und
 * `command-palette` weitere) — mit echtem Seeding wäre die Kachelzahl und damit der
 * Messwert eine Funktion der Nachbarspecs. Interzipiert wird ausschließlich
 * `GET /api/einsaetze`; die Vorlage für die Antwort kommt aus einem ECHTEN
 * `POST /api/einsaetze` (Feldform aus dem Backend, nicht von Hand getippt), das Login
 * läuft unverändert gegen das echte Backend.
 *
 * ── MUTATIONSPROBE (Akzeptanzkriterium), am 11.09.2026 gefahren ──────────────────────
 *
 * `<Card style={{ minHeight: KACHEL_MIN_HOEHE }}>` im `KachelSkelett` auf
 * `KACHEL_MIN_HOEHE / 2` gesetzt:
 *  - Test 1 rot an „Skelett-Kachel #1 (gemessen 108px hoch, Soll ≥ 120)" — der Kachelboden
 *    fängt den Sprung. Dass 108 und nicht 60 gemessen wird, ist der Eigeninhalt der Karte
 *    (drei Skelettbalken plus Polsterung): `minHeight` ist eine Untergrenze, keine Höhe.
 *    Genau deshalb prüft der Test die GEMESSENE Kachel und nicht die Stil-Angabe.
 *  - die Shift-Summe desselben Tests blieb dabei unverändert bei 0.0022, also grün. Das
 *    ist der Befund oben, hier als Messung: die Zweitzusicherung ist nicht Zierat.
 *  - Tests 2 und 3 sind von dieser Mutation nicht betroffen (Test 2 misst den
 *    Ladewechsel mit Suchfeld, Test 3 einen Refetch ohne Ladezustand). Das ist die
 *    Arbeitsteilung, kein Mangel.
 *
 * ── ZWEITE PROBE: TEST 3 OHNE SEINEN AUSLÖSER ────────────────────────────────────────
 *
 * Test 3 hat keinen Produktivcode, den man sinnvoll mutieren könnte — seine Fixture
 * liefert zweimal dieselben Bytes, der Sollwert ist null. Falsifiziert wird er deshalb an
 * sich selbst: das `dispatchEvent` durch einen Kommentar ersetzt. Ergebnis (11.09.2026):
 * rot an „zwischen Reset und Messung darf das Dokument nicht neu geladen haben", zwei
 * verschiedene Lauf-Kennungen 58,7 s auseinander.
 *
 * DAS IST ZUGLEICH DER BEFUND, der den lange ungeklärten zweiten Listen-Abruf erklärt:
 * bleibt die Seite lange genug offen, lädt sie irgendwann von sich aus neu (in einer
 * früheren Fassung ohne Riegel bei 27,8 s beobachtet, hier bei 58,7 s) — vermutlich der
 * Full-Reload des Vite-Dev-Servers, gegen den die Suite fährt. Eine Messung über einen
 * Dokumentwechsel hinweg misst die LADEPHASE des neuen Dokuments: dieselbe `startTime`,
 * dieselbe Summe wie beim ersten Aufbau, und ohne den Riegel sähe das aus wie ein
 * Refetch-Shift von 0.0204. Der Riegel macht daraus eine benannte Fehlermeldung.
 *
 * ── GEMESSENE WERTE (11.09.2026, lokal, Chromium, Fükw 1366 × 768) ───────────────────
 *
 *  - Test 1: Summe 0.0022 aus einem Shift am Rasterknoten. Quelle ist NICHT die
 *    Kachelhöhe, sondern die `Datenstand`-Zeile im Seitenkopf (`EinsatzSeite.tsx`): sie
 *    erscheint mit dem ersten erfolgreichen Abruf und schiebt alles darunter um wenige
 *    Pixel. Kachelhöhen: Skelett 120 px, Einsatzkarte 129,5 px (Boden 120) — die Karte
 *    trägt Titel, Etiketten und zwei Textzeilen und darf größer sein; kleiner nicht.
 *  - Test 2: Summe 0.0204, ebenfalls ein Shift am Rasterknoten — aus Suchfeld-Einschub
 *    UND Reihenzuwachs zusammen, nicht trennbar (siehe `LADEWECHSEL_DECKEL`). Deutlich
 *    unter dem web.dev-Budget, deshalb hier kein Eingriff in `EinsaetzePage`.
 *  - Test 3: nach dem Refetch 0.0000 bei belegtem zweiten Abruf.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Der „gut"-Schwellwert für Cumulative Layout Shift am 75. Perzentil.
 * Quelle: https://web.dev/articles/cls — „a CLS score of 0.1 or less".
 * Bewusst als Literal: ein aus dem Produktivcode gelesener Wert prüfte sich selbst.
 */
const CLS_GUT = 0.1;

/**
 * Deckel für den Ladewechsel mit Aufbau-Änderung (Test 2): die Hälfte des web.dev-Budgets.
 *
 * ZWEI URSACHEN, EINE ZAHL — und das ist ausdrücklich so gemeint: der gemessene Wert
 * 0.0204 enthält den Suchfeld-Einschub ÜBER dem Raster UND den Zuwachs von einer
 * Skelettreihe auf drei Kartenreihen. Die Shift-Quelle ist in beiden Fällen derselbe
 * Rasterknoten, eine Aufteilung wäre also nicht messbar, sondern geschätzt. Ein Deckel,
 * der nur eine der beiden Ursachen im Namen trägt, behauptete eine Trennung, die die
 * Messung nicht hergibt (derselbe Fehler, den Test 1 oben aufdeckt — nur andersherum).
 *
 * Begründung der Höhe: EIN Zustandswechsel dieser Seite darf nicht mehr als die Hälfte des
 * Budgets verbrauchen, das der ganzen Seite über ihre Lebensdauer zusteht — sonst bleibt
 * für alles Weitere kein Raum. Gemessen 0.0204; die Grenze trägt Faktor zwei Luft und
 * fängt trotzdem, wenn dort ein zweiter, größerer Einschub dazukommt.
 */
const LADEWECHSEL_DECKEL = CLS_GUT / 2;

/**
 * Obergrenze für Wechsel, die den Seitenaufbau NICHT ändern (Test 1 und 3).
 *
 * Der Anspruch ist nicht „knapp unter dem web.dev-Limit", sondern „kein Sprung". Ein Wert,
 * der auf 0,09 klettert, wäre unter `CLS_GUT` grün und trotzdem eine Regression.
 *
 * Die Zahl ist eine SETZUNG, keine Rundungstoleranz: gemessen sind 0.0022 (Test 1, der
 * `Datenstand`-Einschub im Kopf — ein Wechsel, der die Seite eben doch minimal ändert) und
 * 0.0000 (Test 3). 0,01 lässt davon Faktor 4,5 Luft, liegt aber eine Größenordnung unter
 * dem web.dev-Budget und eine halbe unter dem gemessenen Ladewechsel aus Test 2 (0.0204).
 * Wer sie anhebt, hebt eine Zusicherung an, keine Toleranz.
 */
const HAUS_GRENZE = 0.01;

/**
 * `KACHEL_MIN_HOEHE` aus `EinsaetzePage.tsx` als Literal.
 *
 * Aus dem Produktivcode importiert prüfte der Test die Konstante gegen sich selbst und
 * bliebe auch dann grün, wenn sie auf 10 fiele (dieselbe Begründung wie bei den
 * Dichte-Böden in `gate3-trefflaeche.spec.ts`). Fällt der Wert dort, wird dieser Test rot
 * und die Änderung ist eine bewusste Entscheidung statt eines Nebenprodukts.
 */
const KACHEL_BODEN = 120;

/**
 * Subpixel-Spielraum wie in `gate3-trefflaeche.spec.ts`: `boundingBox()` liefert
 * Fließkomma, und Chromium rundet unter Last anders als im Einzellauf.
 */
const SUBPIXEL = 0.5;

/** Fükw-Maß aus der Bedien-Leitlinie (A1, Gate 1). Die Einsatzauswahl ist eine Fükw-Route. */
const FUEKW = { width: 1366, height: 768 };

/**
 * `SUCHE_AB` aus `EinsaetzePage.tsx` als Literal — fällt die Schwelle dort, erscheint das
 * Suchfeld in Test 1 unerwartet mit und die dortige `toHaveCount(0)`-Wache sagt es laut.
 */
const SUCHE_AB = 8;

/**
 * `staleTime` aus `api/queryClient.ts` als Literal.
 *
 * Ein Fokus-Ereignis auf einer FRISCHEN Query löst keinen Refetch aus — Test 3 muss die
 * Query also erst altern lassen, sonst belegte er nichts als die eigene Ungeduld. Steigt
 * der Wert im Produktivcode, sagt die Abruf-Zusicherung in Test 3 es laut.
 */
const STALE_TIME = 10_000;

/**
 * Ein Tor, das die interzipierte Listen-Antwort zurückhält, bis der Test sie freigibt.
 *
 * KEINE feste Verzögerung — das war die erste Fassung (400 ms) und ist im Volllauf der
 * Suite am 11.09.2026 GEMESSEN gescheitert: „Skelett-Kachel #2: kein Kasten messbar",
 * `boundingBox()` lieferte `null`. Unter Last liegen zwischen dem `toHaveCount(3)` und
 * der Messung der zweiten Kachel genug Millisekunden, dass die Antwort eintrifft und die
 * Skelette aus dem DOM fallen. Jede Zahl, die man stattdessen einsetzt, ist ein
 * Wettrennen mit der Maschine; das Tor hat keins: die Skelettphase dauert exakt so lange,
 * wie der Test misst.
 */
function ladeTor(): { tor: Promise<void>; oeffne: () => void } {
  let oeffne!: () => void;
  const tor = new Promise<void>((fertig) => {
    oeffne = fertig;
  });
  return { tor, oeffne };
}

/** Ein Shift-Eintrag, wie ihn der Beobachter im Dokument sammelt. */
interface ShiftEintrag {
  wert: number;
  zeit: number;
  quellen: string[];
}

interface Messung {
  summe: number;
  eintraege: ShiftEintrag[];
  /** Kennung des Dokuments, in dem gemessen wurde — siehe {@link beobachteShifts}. */
  lauf: string;
}

// Login-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein geteiltes
// e2e-Hilfsmodul (gleichlautend in den Bestands-Specs vermerkt).
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/**
 * Registriert den `layout-shift`-Beobachter VOR jedem Dokument-Script.
 *
 * `addInitScript` statt `evaluate` nach dem Laden: ein nachträglich registrierter
 * Beobachter verpasst zwar dank `buffered: true` keine Einträge, aber `evaluate` selbst
 * braucht ein geladenes Dokument — die Registrierung käme dann frühestens nach dem ersten
 * Rendern, und der Akkumulator müsste über die Navigation hinweg gerettet werden.
 *
 * Der Akkumulator lebt PRO DOKUMENT: jede echte Navigation setzt ihn zurück. Das ist die
 * gewünschte Semantik — die Shifts der Login-Seite gehören nicht in die Messung der
 * Einsatzauswahl. Aus demselben Grund navigiert jeder Test nach `anmelden()` noch einmal
 * per `page.goto`: der Login schickt per React Router weiter, also IM SELBEN Dokument.
 */
async function beobachteShifts(page: Page) {
  await page.addInitScript(() => {
    interface Zustand {
      summe: number;
      eintraege: { wert: number; zeit: number; quellen: string[] }[];
      lauf: string;
    }
    // Die Kennung entsteht EINMAL je Dokument. Lädt die Seite unbemerkt neu, läuft dieses
    // Script erneut und vergibt eine neue — daran erkennt Test 3 eine Messung, die über
    // einen Dokumentwechsel hinweg lief und damit nichts belegt (gemessen: bei einem
    // solchen Reload stand die Ladephase mit ihrer eigenen `startTime` wieder im frisch
    // angelegten Akkumulator, und die Summe sah aus wie ein Refetch-Shift).
    const zustand: Zustand = {
      summe: 0,
      eintraege: [],
      lauf: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    (window as unknown as { __lfhShift: Zustand }).__lfhShift = zustand;

    // Knotenbeschreibung statt Knoten: ein roter Test soll sagen, WAS sich bewegt hat.
    // `className` ist bei SVG-Knoten ein `SVGAnimatedString` und kein String — deshalb die
    // Typprüfung statt eines blinden `.split`.
    const beschreibe = (knoten: Node | null): string => {
      if (!knoten || !(knoten instanceof Element)) return '(kein Element)';
      const testid = knoten.getAttribute('data-testid');
      const klassen =
        typeof knoten.className === 'string' && knoten.className.trim()
          ? `.${knoten.className.trim().split(/\s+/).join('.')}`
          : '';
      return `${knoten.tagName.toLowerCase()}${klassen}${testid ? `[${testid}]` : ''}`;
    };

    const beobachter = new PerformanceObserver((liste) => {
      for (const eintrag of liste.getEntries()) {
        const shift = eintrag as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node: Node | null }[];
        };
        // `hadRecentInput`: Verschiebungen innerhalb von 500 ms nach einer Nutzereingabe
        // sind erwartete Folgen der Bedienung und zählen in keiner CLS-Definition mit.
        if (shift.hadRecentInput) continue;
        zustand.summe += shift.value;
        zustand.eintraege.push({
          wert: shift.value,
          zeit: Math.round(shift.startTime),
          quellen: (shift.sources ?? []).map((q) => beschreibe(q.node)),
        });
      }
    });
    // `buffered: true` liefert auch die Einträge nach, die vor dieser Zeile entstanden
    // sind — hier zwar keine, aber ohne das Flag hinge die Messung an der Reihenfolge
    // zweier Frames.
    beobachter.observe({ type: 'layout-shift', buffered: true });
  });
}

/** Momentaufnahme des Akkumulators. */
async function leseShifts(page: Page): Promise<Messung> {
  return page.evaluate(() => {
    const z = (window as unknown as { __lfhShift?: Messung }).__lfhShift;
    if (!z) throw new Error('Shift-Beobachter fehlt — addInitScript hat nicht gegriffen');
    return { summe: z.summe, eintraege: z.eintraege, lauf: z.lauf };
  });
}

/**
 * Setzt den Akkumulator zurück, ohne den Beobachter neu zu registrieren.
 *
 * Test 3 braucht die Shifts AB einem Zeitpunkt, nicht seit dem Dokumentanfang. Eine
 * Differenz zweier Ruhelagen täte es nicht: ein Nachzügler-Shift aus dem Seitenaufbau
 * (nachgeladene Schrift, verspätetes Bild) landete dann im Delta und machte den Test
 * flaky — genau das ist am 11.09.2026 in einem Lauf passiert. Nach dem Zurücksetzen ist
 * die Aussage absolut: „ab hier bewegt sich nichts mehr".
 */
async function setzeShiftsZurueck(page: Page) {
  await page.evaluate(() => {
    const z = (window as unknown as { __lfhShift?: { summe: number; eintraege: unknown[] } })
      .__lfhShift;
    if (!z) throw new Error('Shift-Beobachter fehlt — addInitScript hat nicht gegriffen');
    z.summe = 0;
    z.eintraege.length = 0;
  });
}

/** Wie viele gleiche Lesungen in Folge als Ruhe gelten — siehe {@link ruheShifts}. */
const STILLE_RUNDEN = 4;
/** Abstand zwischen zwei Lesungen. `STILLE_RUNDEN` × dieser Wert ist das Ruhefenster. */
const LESE_ABSTAND = 150;

/**
 * Wartet, bis der Akkumulator zur Ruhe kommt — `STILLE_RUNDEN` gleiche Lesungen in Folge.
 *
 * KEIN fester Timeout: ein `waitForTimeout(1000)` wäre lokal großzügig und unter Volllast
 * der Suite (drei Worker, Vite übersetzt nebenher) zu knapp — der Test würde dann eine
 * Ruhelage messen, die noch gar nicht eingetreten ist, und wäre grün durch zu frühes
 * Hinsehen.
 *
 * VIER Lesungen, nicht zwei (Review-Befund): mit zwei genügte EIN stilles Fenster von
 * 100 ms, um „Ruhe" zu melden. Ein Nachzügler bei +300 ms — nachgeladene Schrift,
 * verspätete Style-Injektion, Reflow unter Last — wäre nie gesehen worden, die Summe zu
 * klein und JEDE Summen-Zusicherung dieser Datei grün durch zu frühes Hinsehen. Genau das,
 * wogegen die Schleife gebaut ist. Vier Runden à 150 ms sind 450 ms Stille.
 *
 * Und die Schleife WIRFT, wenn sie das Fenster nie erreicht: „kommt nicht zur Ruhe" ist von
 * „ist ruhig" sonst nicht zu unterscheiden, und ein Zwischenwert kann zufällig unter der
 * Grenze liegen — ein stiller Falsch-Grün.
 */
async function ruheShifts(page: Page, runden = 60): Promise<Messung> {
  let vorher = Number.NaN;
  let gleich = 0;
  let letzte: Messung = { summe: 0, eintraege: [], lauf: '' };
  for (let i = 0; i < runden; i += 1) {
    letzte = await leseShifts(page);
    gleich = letzte.summe === vorher ? gleich + 1 : 0;
    if (gleich >= STILLE_RUNDEN - 1) return letzte;
    vorher = letzte.summe;
    await page.waitForTimeout(LESE_ABSTAND);
  }
  throw new Error(
    `Die Layout-Shifts kamen in ${runden} Runden à ${LESE_ABSTAND} ms nicht zur Ruhe — ` +
      `zuletzt ${bericht(letzte)}. Ein Zwischenwert unter der Grenze wäre ein stiller ` +
      'Falsch-Grün, deshalb ist das ein Fehler und keine Messung.',
  );
}

/** Menschenlesbare Anmerkung für den Testbericht — Summe plus jede bewegte Quelle. */
function bericht(messung: Messung): string {
  if (messung.eintraege.length === 0) return `Summe ${messung.summe.toFixed(4)} (keine Shifts)`;
  const zeilen = messung.eintraege.map(
    (e) => `${e.wert.toFixed(4)} @${e.zeit}ms [${e.quellen.join(', ') || 'ohne Quelle'}]`,
  );
  return `Summe ${messung.summe.toFixed(4)} aus ${messung.eintraege.length}: ${zeilen.join(' · ')}`;
}

/**
 * Legt EINEN echten Einsatz an und gibt die Backend-Antwort als Vorlage zurück.
 *
 * Die Feldform von `EinsatzAnzeige` (`src/einsatz/mod.rs`) trägt Pflichtfelder wie
 * `org_id`/`org_name`/`angelegt_at`, die von Hand getippt beim nächsten Backend-Feld
 * stillschweigend veralten würden. Die Session ist Cookie-basiert und `page.request` teilt
 * den Cookie-Jar des Kontexts (`gate1-ueberlauf.spec.ts`).
 */
async function vorlageHolen(page: Page, bezeichnung: string): Promise<EinsatzAnzeige> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(
    antwort.ok(),
    `Vorlage-Einsatz „${bezeichnung}": ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
  return (await antwort.json()) as EinsatzAnzeige;
}

/**
 * Baut aus der Vorlage eine feste Liste: `aktiv` aktive und `abgeschlossen` abgeschlossene
 * Einsätze.
 *
 * Der abgeschlossene Einsatz ist bewusst in jeder Fixture: er stellt die
 * „Abgeschlossen"-Sektion UNTER das Raster, sodass ein Shift dort eine zweite, benannte
 * Quelle bekommt. Er ist NICHT das Messobjekt für den Ladewechsel — im Ladezustand gibt es
 * ihn noch nicht (siehe Kopfkommentar), und genau deshalb trägt Test 1 zusätzlich den
 * Kachelboden.
 *
 * Die ids laufen ab einer hohen Basis, damit sie mit echten Datensätzen der Nachbarspecs
 * nicht kollidieren, falls die Interception einmal ausfällt.
 */
function baueListe(
  vorlage: EinsatzAnzeige,
  stempel: number,
  aktiv: number,
  abgeschlossen: number,
): EinsatzAnzeige[] {
  const liste: EinsatzAnzeige[] = [];
  for (let n = 1; n <= aktiv; n += 1) {
    liste.push({
      ...vorlage,
      id: 900_000 + n,
      bezeichnung: `E2E CLS ${stempel} Nr ${n}`,
      status: 'aktiv',
    });
  }
  for (let n = 1; n <= abgeschlossen; n += 1) {
    liste.push({
      ...vorlage,
      id: 950_000 + n,
      bezeichnung: `E2E CLS ${stempel} Abgeschlossen ${n}`,
      status: 'abgeschlossen',
    });
  }
  return liste;
}

/**
 * Interzipiert `GET /api/einsaetze` mit einer festen Antwort und zählt die Abrufe.
 *
 * Der Methoden-Riegel ist Vorsorge, kein Bestandsfix: `POST /api/einsaetze` trifft dieselbe
 * URL. Heute läuft `vorlageHolen()` in allen drei Tests VOR `stelleListe()`, der Riegel
 * kann auf dem Seeding-Pfad also gar nicht feuern — wer die Reihenfolge umstellt oder einen
 * zweiten Einsatz nach der Registrierung anlegt, wäre ohne ihn sofort betroffen.
 *
 * Der Zähler ist der Beleg für Test 3 — ohne ihn wäre „ein Refetch erzeugt keinen Shift"
 * auch dann grün, wenn gar kein Refetch stattfand.
 */
async function stelleListe(
  page: Page,
  liste: EinsatzAnzeige[],
  tor?: Promise<void>,
): Promise<{ abrufe: number; zeiten: number[] }> {
  const start = Date.now();
  const zaehler: { abrufe: number; zeiten: number[] } = { abrufe: 0, zeiten: [] };
  await page.route(/\/api\/einsaetze(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Das Tor hält die Antwort zurück, solange der Test misst. Nach `oeffne()` löst das
    // Promise sofort auf, jeder weitere Abruf läuft also ungebremst durch.
    if (tor) await tor;
    await route.fulfill({ json: liste });
    // GEZÄHLT WIRD NACH DEM AUSLIEFERN (Review-Befund). Am Eintritt gezählt, meldete der
    // Zähler bereits das Abfangen der Anfrage — Test 3 hätte dann seine Messung starten
    // können, bevor react-query die Antwort überhaupt verarbeitet hat, und die
    // Null-Zusicherung wäre still grün geworden, ohne etwas gesehen zu haben.
    zaehler.abrufe += 1;
    zaehler.zeiten.push(Date.now() - start);
  });
  return zaehler;
}

/** Anker: der Ladezustand steht (das Raster meldet `aria-busy`). */
async function skelettSteht(page: Page) {
  await expect(page.getByTestId('einsaetze-raster')).toHaveAttribute('aria-busy', 'true');
}

/** Anker: die Daten sind da — `aria-busy` ist weg und die erste Karte trägt ihren Titel. */
async function kartenStehen(page: Page, ersterName: string) {
  const raster = page.getByTestId('einsaetze-raster');
  await expect(raster).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.getByRole('link', { name: ersterName, exact: true })).toHaveCount(1);
}

/**
 * Misst jede Kachel einer Menge gegen den Kachelboden (Untergrenze, nie Gleichheit).
 *
 * `sollZahl` ist die Zahl, die die Fixture garantiert — und sie wird auf GLEICHHEIT
 * geprüft, nicht als Untergrenze: die Fixture stellt die Liste selbst (`page.route`), die
 * Kachelzahl ist also bekannt und nicht geschätzt. Ein Locator, der weniger trifft, misst
 * einen Zwischenzustand; einer, der mehr trifft, misst etwas anderes als gedacht — beides
 * ist ein Fehler, keine grüne Zeile. (`gate3-trefflaeche.spec.ts` nutzt an dieser Stelle
 * eine Untergrenze, weil es dort gegen echte, parallel gesäte Daten misst.) Der
 * `toHaveCount` wiederholt sich von selbst und ist damit zugleich der Anker auf den
 * fertigen Zustand.
 */
async function kachelnHaltenBoden(
  page: Page,
  auswahl: string,
  name: string,
  sollZahl: number,
): Promise<number> {
  const kacheln = page.getByTestId('einsaetze-raster').locator(auswahl);
  await expect(kacheln, `${name}: genau ${sollZahl} Kacheln erwartet`).toHaveCount(sollZahl);
  let kleinstes = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sollZahl; i += 1) {
    const kasten = await kacheln.nth(i).boundingBox();
    expect(kasten, `${name} #${i + 1}: kein Kasten messbar`).not.toBeNull();
    expect(
      kasten!.height,
      `${name} #${i + 1} (gemessen ${kasten!.height}px hoch, Soll ≥ ${KACHEL_BODEN})`,
    ).toBeGreaterThanOrEqual(KACHEL_BODEN - SUBPIXEL);
    kleinstes = Math.min(kleinstes, kasten!.height);
  }
  return kleinstes;
}

test('Einsatzauswahl: der Ladewechsel Skelett → Karten hält den Kachelboden und verschiebt nichts', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await beobachteShifts(page);
  await anmelden(page);

  const stempel = Date.now();
  const vorlage = await vorlageHolen(page, `E2E CLS ${stempel} Vorlage A`);

  // ZWEI aktive Einsätze, nicht drei: die Anlegen-Kachel („Neuer Einsatz") steht als
  // erstes Rasterkind, der Admin darf anlegen. Zwei Karten plus Kachel füllen dieselbe
  // EINE Reihe wie die drei Skelette — das ist der Fall, den `KACHEL_MIN_HOEHE` zusichert.
  const liste = baueListe(vorlage, stempel, 2, 1);
  const { tor, oeffne } = ladeTor();
  await stelleListe(page, liste, tor);

  // Eigene Navigation nach dem Login: der Login-Klick schickt per React Router weiter und
  // teilte sich sonst Dokument und Shift-Akkumulator mit der Anmeldemaske.
  await page.goto('/einsaetze');

  await skelettSteht(page);
  // Die drei Skelettkacheln stehen unbedingt (`EinsaetzePage.tsx`, kein `&&` davor) — und
  // sie stehen STILL, solange das Tor zu ist. Ohne das fiel diese Messung unter Last aus
  // (siehe `ladeTor`).
  const skelettHoehe = await kachelnHaltenBoden(page, '.ant-card', 'Skelett-Kachel', 3);

  // Das Suchfeld darf hier NICHT erscheinen — sonst misst dieser Test den Einschub aus
  // Test 2 mit und die beiden Aussagen wären nicht mehr trennbar.
  expect(liste.filter((e) => e.status === 'aktiv').length).toBeLessThan(SUCHE_AB);
  oeffne();
  await kartenStehen(page, liste[0].bezeichnung);
  await expect(page.getByLabel('Einsätze durchsuchen')).toHaveCount(0);
  const kartenHoehe = await kachelnHaltenBoden(page, '.ant-card', 'Einsatzkarte', 2);
  // Der Knoten unter dem Raster muss wirklich stehen, sonst hat ein Shift dort keine Quelle.
  await expect(page.getByRole('link', { name: liste[2].bezeichnung, exact: true })).toHaveCount(1);

  const messung = await ruheShifts(page);
  test.info().annotations.push({
    type: 'messwert',
    description: `Skelett-Kachel ${skelettHoehe}px, Einsatzkarte ${kartenHoehe}px (Boden ${KACHEL_BODEN}) | ${bericht(messung)}`,
  });

  expect(messung.summe, `Ladewechsel gegen web.dev: ${bericht(messung)}`).toBeLessThanOrEqual(
    CLS_GUT,
  );
  expect(
    messung.summe,
    `Ladewechsel gegen die Hausgrenze: ${bericht(messung)}`,
  ).toBeLessThanOrEqual(HAUS_GRENZE);
});

test('Einsatzauswahl: der Ladewechsel mit Suchfeld und drei Rasterreihen bleibt im CLS-Budget', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await beobachteShifts(page);
  await anmelden(page);

  const stempel = Date.now();
  const vorlage = await vorlageHolen(page, `E2E CLS ${stempel} Vorlage B`);

  // Genau `SUCHE_AB` aktive Einsätze. Damit ändert der Ladewechsel den Seitenaufbau an
  // ZWEI Stellen zugleich: das Suchfeld erscheint ÜBER dem Raster, und das Raster selbst
  // wächst von einer Skelettreihe auf drei Kartenreihen (acht Karten plus Anlegen-Kachel
  // bei drei Spalten). Beide schieben denselben Rasterknoten, die gemessenen 0.0204 lassen
  // sich also nicht auf eine der Ursachen aufteilen — siehe `LADEWECHSEL_DECKEL`.
  // Das ist ein ECHTER Shift und kein Nullwert: der Test belegt, dass er im Budget bleibt,
  // nicht dass es ihn nicht gibt.
  const liste = baueListe(vorlage, stempel, SUCHE_AB, 1);
  const { tor, oeffne } = ladeTor();
  await stelleListe(page, liste, tor);

  await page.goto('/einsaetze');
  // Auch hier das Tor, obwohl dieser Test keine Skelettkachel misst: ohne es kann die
  // Antwort unter Last vor dem `aria-busy`-Anker eintreffen, und der Test stürbe an einer
  // Skelettphase, die es sehr wohl gab — nur eben zu kurz zum Hinsehen.
  await skelettSteht(page);
  oeffne();
  await kartenStehen(page, liste[0].bezeichnung);
  await expect(page.getByLabel('Einsätze durchsuchen')).toHaveCount(1);

  const messung = await ruheShifts(page);
  test.info().annotations.push({ type: 'messwert', description: bericht(messung) });

  expect(messung.summe, `Ladewechsel gegen web.dev: ${bericht(messung)}`).toBeLessThanOrEqual(
    CLS_GUT,
  );
  expect(
    messung.summe,
    `Ladewechsel gegen den Zustandswechsel-Deckel: ${bericht(messung)}`,
  ).toBeLessThanOrEqual(LADEWECHSEL_DECKEL);
});

test('Einsatzauswahl: ein Fensterfokus-Refetch mit unveränderten Daten verschiebt nichts', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await beobachteShifts(page);
  await anmelden(page);

  const stempel = Date.now();
  const vorlage = await vorlageHolen(page, `E2E CLS ${stempel} Vorlage C`);
  const liste = baueListe(vorlage, stempel, SUCHE_AB, 1);
  // Ohne Verzögerung: hier interessiert nicht der Ladewechsel, sondern was NACH ihm
  // passiert. Der Ladeanteil wird unten per Zurücksetzen aus der Messung genommen.
  const zaehler = await stelleListe(page, liste);

  await page.goto('/einsaetze');
  await kartenStehen(page, liste[0].bezeichnung);
  const ladephase = await ruheShifts(page);

  // Die Query muss erst altern (siehe `STALE_TIME`), sonst ignoriert react-query das
  // Fokus-Ereignis und der Test belegte nichts.
  await page.waitForTimeout(STALE_TIME + 500);

  // Erst JETZT zurücksetzen: alles Nachladen des Seitenaufbaus ist vorbei, was ab hier
  // gemeldet wird, gehört zum Refetch.
  await setzeShiftsZurueck(page);

  // Der Stand des `Datenstand`-Titels VOR dem Refetch. Er trägt Sekunden
  // (`components/Datenstand.tsx`, `DD.MM.YYYY HH:mm:ss`), während sichtbar nur `HH:mm`
  // steht — nach den 10,5 s oben ist er also garantiert ein anderer, sobald react-query
  // die Antwort verarbeitet UND gerendert hat. Genau das ist der Anker, der dem Zähler
  // fehlt: der zählt das Ausliefern, nicht das Ankommen im DOM. Und weil nur das
  // `title`-Attribut sich sicher ändert, verschiebt dieser Anker selbst nichts.
  const datenstand = page.locator('[aria-label^="Datenstand "]');
  await expect(datenstand).toHaveCount(1);
  const standVorher = await datenstand.getAttribute('title');
  expect(standVorher, 'der Datenstand muss vor dem Refetch einen Titel tragen').not.toBeNull();

  // RELATIV gezählt, und der Stand wird ERST HIER genommen (Review-Befund). In einer
  // früheren Fassung stand diese Zeile vor den 10,5 s Wartezeit: ein Abruf in diesem
  // Fenster hätte den Zähler schon auf den Zielwert gehoben, und die Zusicherung unten wäre
  // grün gewesen, ohne dass der Fokus irgendetwas ausgelöst hat. Absolut gezählt („genau
  // ein Abruf") war die Fassung davor, und die fiel im Lauf mit drei Workern mit zwei
  // Abrufen aus — die Aussage dieses Tests ist ohnehin relativ.
  const abrufeVorher = zaehler.abrufe;
  expect(abrufeVorher, 'vor dem Refetch mindestens der Erstabruf').toBeGreaterThanOrEqual(1);
  const laufVorher = (await leseShifts(page)).lauf;

  // Das Warten auf die Antwort wird VOR dem Auslöser aufgesetzt, sonst ginge sie zwischen
  // beiden Zeilen verloren. Bleibt der Refetch aus, stirbt der Test hier — und das ist der
  // scharfe Beleg, den der Zähler allein nicht liefert.
  const antwort = page.waitForResponse(
    (r) => /\/api\/einsaetze(\?|$)/.test(r.url()) && r.request().method() === 'GET',
  );

  // react-querys `focusManager` hängt am `visibilitychange`-Ereignis des Fensters
  // (`@tanstack/query-core`, `focusManager.setEventListener`). Es von Hand zu feuern ist
  // die deterministische Fassung dessen, was der Browser beim Fensterwechsel tut. Ein
  // zweites Tab per `bringToFront` wäre der nativere Auslöser, in headless Chromium aber
  // nicht zuverlässig.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await antwort;

  await expect
    .poll(() => zaehler.abrufe, {
      message: 'der Fensterfokus muss einen zusätzlichen Abruf auslösen',
    })
    .toBeGreaterThanOrEqual(abrufeVorher + 1);
  // Erst mit dem neuen Titel ist die Antwort im DOM angekommen. Ohne diesen Anker könnte
  // die Ruhemessung unten enden, bevor das Re-Render überhaupt lief — bei einem Sollwert
  // von 0 ein stiller Falsch-Grün.
  await expect(datenstand).not.toHaveAttribute('title', standVorher!);

  const nachRefetch = await ruheShifts(page);
  // Ein Refetch tauscht Daten, kein Dokument. Lud die Seite dazwischen neu, misst der
  // frische Akkumulator die LADEPHASE und nicht den Refetch — die Summe sähe nach einem
  // Refetch-Shift aus, wäre aber der Seitenaufbau (im Selbstbeweis unten so beobachtet).
  // Das ist ein Fehler der Messung, kein Befund über die Seite, und muss sich als solcher
  // melden statt als Zahl.
  expect(
    nachRefetch.lauf,
    'zwischen Reset und Messung darf das Dokument nicht neu geladen haben',
  ).toBe(laufVorher);
  test.info().annotations.push({
    type: 'messwert',
    description:
      `Ladephase ${bericht(ladephase)} | nach Refetch ${bericht(nachRefetch)} | ` +
      `Abrufe bei ${zaehler.zeiten.join(', ')} ms (davon ${abrufeVorher} vor dem Fokus)`,
  });

  // Befund M5 der LFH-336-Prüfliste: die Sortierung nach `begonnen_at` desc könnte bei
  // einem Fokus-Refetch klickbare Karten umsortieren. Bei UNVERÄNDERTEN Daten darf dabei
  // nichts passieren — react-query teilt die Struktur und rendert identisch.
  expect(
    nachRefetch.summe,
    `Refetch ohne Datenänderung: ${bericht(nachRefetch)}`,
  ).toBeLessThanOrEqual(HAUS_GRENZE);
});
