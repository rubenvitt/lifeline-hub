import { expect, test, type Page } from '@playwright/test';

/**
 * Tippverzögerung im Lageberichtsentwurf am Fükw-Maß (LFH-495, Nachzug C13/N4).
 *
 * DER BEFUND: `Form.useWatch([], form)` in `LageberichtDetailPage` beobachtet ALLE Werte,
 * damit die Leer-Marke der Akkordeon-Kopfzeilen dem Tippen folgt und nicht dem Speichern.
 * Folge: die Detailseite rendert je Tastenanschlag neu — Kopfzeile, Akkordeon und ACHT
 * Editoren, die alle `forceRender` tragen und ihre Höhe per `autoSize` nachmessen. Das
 * Ticket verlangt, das am 13"-Fükw zu MESSEN und erst bei Bedarf einzugreifen (Beobachtung
 * auf die Abschnittspfade einschränken oder die Leer-Marke entprellen).
 *
 * WARUM HIER UND NICHT IN VITEST: jsdom rechnet kein Layout und führt `autoSize` nicht aus —
 * genau die Arbeit, um die es geht. Eine Render-Zählung im Komponententest wäre die falsche
 * Größe: dass es rendert, ist bekannt und beabsichtigt; die Frage ist, ob es WEHTUT.
 *
 * GEMESSEN WIRD DIE VERZÖGERUNG BIS ZUM BILD, nicht die Renderzeit: je `keydown` ein
 * Zeitstempel, abgelesen im zweiten `requestAnimationFrame` danach — das liegt hinter dem
 * Paint des Rahmens, in dem React fertig geworden ist. Eine reine `performance.now()`-Klammer
 * um den Anschlag läse nur die synchrone Hälfte und ließe Layout und Paint draußen, also das
 * Teure.
 *
 * DER BEFEHLSENTWURF IST DIE KONTROLLE, und das ist der Kern der Aussage: dieselben
 * `MarkdownEditor`-Felder mit `autoSize`, dieselbe Erfassungsmechanik — aber KEIN
 * `Form.useWatch`. Der Unterschied der beiden Zahlen ist der Preis der Beobachtung. Ohne die
 * Kontrolle wäre jeder Messwert nur „Tippen kostet etwas" und keine Aussage über `useWatch`.
 *
 * ── DAS ERGEBNIS ──────────────────────────────────────────────────────────────────────────
 *
 * Ruhiger Container (12 Kerne, ein Worker), je dreimal:
 *
 *                      Median      p90      schlechtester
 *   vorher              36 ms     73 ms     125–138 ms
 *   nachher             26–39 ms  43–48 ms  120–130 ms
 *   Befehl (Kontrolle)  17–18 ms  29–33 ms   58–77 ms
 *
 * DER BEFUND IST BESTÄTIGT, ABER NICHT DA, WO DAS TICKET IHN VERMUTETE. Beide dort
 * vorgeschlagenen Eingriffe wären wirkungslos gewesen:
 *
 *  · „auf die Abschnittspfade einschränken" — `Form.useWatch` nimmt EINEN Pfad; acht
 *    Abschnitte bräuchten acht Hooks, und deren Zahl steht erst zur Laufzeit fest (die
 *    Vorlage entscheidet sie). Vor allem aber sind die Abschnittspfade GENAU das, was sich
 *    beim Tippen ändert — die Einschränkung spart den Anschlag nicht ein, um den es geht.
 *  · „die Leer-Marke entprellen" — die Marke ist nicht der Preis. Den Render löst der HOOK
 *    aus, nicht sein Ergebnis; einen abgeleiteten Wert später zu berechnen lässt den Render
 *    stehen.
 *
 * Was wirkt, ist die KASKADE zu unterbinden: `AbschnittsAkkordeon` ist memoisiert, `befuellt`
 * läuft über ein Primitiv (`befuellungsKette`) und der `editor` über `useCallback`. Damit
 * rendert der Elternteil weiter je Anschlag — Kopfzeile und Etiketten, billig —, die acht
 * Editoren mit ihrer `autoSize`-Nachmessung aber nicht mehr.
 *
 * ── WARUM HIER KEINE ZEITSCHWELLE STEHT (gemessen, erster CI-Lauf dieses Tests) ────────────
 *
 * Der erste Anlauf trug einen p90-Deckel von 60 ms. Auf dem GitHub-Runner (2 vCPU, zwei
 * Playwright-Worker auf zwei Kernen) maß derselbe Stand **83,4 ms**, im Wiederholversuch
 * **62,5 ms** — beide rot, obwohl die Memoisierung drin ist. Die Kontrolle lag gleichzeitig
 * bei 32,6 bzw. 36,0 ms, das VERHÄLTNIS also bei 2,56 und 1,74; der Stand OHNE Memoisierung
 * lag im ruhigen Container bei 2,35. Die Bereiche überlappen, ein Schwellwert darauf könnte
 * „behoben" und „nicht behoben" nicht trennen. Ein absoluter Millisekunden-Deckel für
 * Eingabelatenz ist auf geteilten zwei Kernen keine Zusicherung, sondern ein Würfel — und
 * „ein rot geborenes Gate wird abgeschaltet statt befolgt" (CLAUDE.md).
 *
 * DIE ZUSICHERUNG STEHT DESHALB DETERMINISTISCH IN VITEST:
 * `lageberichte/AbschnittsAkkordeon.test.tsx` zählt die Aufrufe der `editor`-Render-Prop und
 * belegt ohne Uhr, dass der Teilbaum bei unveränderten Props NICHT neu rendert. Das ist die
 * Eigenschaft, die die Millisekunden erzeugt hat; sie ist hardwareunabhängig prüfbar.
 *
 * WAS HIER BLEIBT, ist die MESSUNG samt Struktur-Vorbedingungen: dass der Einstiegsfokus
 * sitzt und alle acht Editoren im DOM stehen (ohne beides wäre die Zahl bedeutungslos), und
 * die Zahlen selbst in Log und Annotation — sie sind der Nachweis, den das Ticket verlangt
 * („am 13"-Fükw messen"), und sie stehen bei jedem Lauf im Bericht, statt in einem Kommentar
 * zu verrotten. Wer auf ruhiger Hardware eine Schwelle fahren will, setzt `PW_LATENZ=1`:
 * dann gelten die RAIL-Deckel unten. In der CI ist die Variable nicht gesetzt.
 *
 * OFFEN GEBLIEBEN UND BENANNT: der schlechteste Anschlag liegt unverändert bei 120–130 ms
 * und damit über der RAIL-Grenze von 100 ms. Die Memoisierung hat ihn NICHT bewegt, er hängt
 * also nicht an `useWatch` — wahrscheinlich an der `autoSize`-Neumessung beim Zeilenumbruch
 * des getippten Feldes, die auch die Kontrolle auf 58–77 ms hebt (auf dem Runner auf 119).
 * Das ist eine eigene Untersuchung und kein Nebenprodukt dieses Nachzugs; hier wird sie
 * gemessen und nicht behauptet, sie sei behoben.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Die RAIL-Deckel gelten nur mit `PW_LATENZ=1` — auf ruhiger Hardware, von Hand. Begründung
 * im Kopfkommentar: auf zwei geteilten Kernen trennen sie nichts.
 */
const LATENZ_GATE = process.env.PW_LATENZ === '1';
/** RAIL: Verarbeitungsbudget eines Eingabeereignisses. */
const MEDIAN_MAX_MS = 50;
/** Gemessen 43–48 ms mit memoisiertem Akkordeon, 73 ms ohne. */
const P90_MAX_MS = 60;
/** RAIL: ab hier wirkt eine Reaktion nicht mehr unmittelbar. */
const SCHLECHTESTER_MAX_MS = 150;

/** Genug Anschläge für einen belastbaren Median, wenige genug für einen kurzen Lauf. */
const ANSCHLAEGE = 40;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/** „Lagevortrag zur Entscheidung": die Vorlage mit den meisten Abschnitten (acht). */
async function lageberichtAnlegen(page: Page, einsatzId: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/lageberichte`, {
    data: { vorlage: 'lagebeurteilung', titel: 'Tippmessung' },
  });
  expect(antwort.ok(), await antwort.text()).toBe(true);
  return (await antwort.json()).id as number;
}

/** Befehl LADEF (erweitert): fünf Abschnitte, alle gleichzeitig ausgeklappt. */
async function befehlAnlegen(page: Page, einsatzId: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/befehle`, {
    data: { vorlage: 'befehl_ladef', titel: 'Tippmessung Befehl' },
  });
  expect(antwort.ok(), await antwort.text()).toBe(true);
  return (await antwort.json()).id as number;
}

interface Messung {
  median: number;
  /** Der neunte von zehn Anschlägen — trägt die Aussage, nicht der einzelne Ausreisser. */
  p90: number;
  schlechtester: number;
  anzahl: number;
}

/**
 * Tippt in das fokussierte Feld und liest je Anschlag die Verzögerung bis zum Bild.
 *
 * Der Beobachter hängt am Dokument (`capture`), nicht am Feld: React ersetzt bei jedem
 * Render die Props des Textfeldes, das Element selbst bleibt — ein Listener am Element hielte
 * also, aber am Dokument hält er auch dann, wenn ein Umbau das Feld austauscht.
 */
async function tippverzoegerung(page: Page, text: string): Promise<Messung> {
  await page.evaluate(() => {
    const fenster = window as unknown as { __latenzen: number[] };
    fenster.__latenzen = [];
    document.addEventListener('keydown', () => {
      const start = performance.now();
      // Zwei Rahmen: der erste läuft VOR dem Paint des laufenden Rahmens, der zweite
      // danach — erst dort ist das Bild, das die Person sieht, tatsächlich gezeichnet.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fenster.__latenzen.push(performance.now() - start);
      }));
    }, { capture: true });
  });

  // 30 ms Abstand ≈ schnelles Schreiben (rund 400 Zeichen/Minute) und lässt jeden Anschlag
  // seinen eigenen Rahmen bekommen. Ohne Abstand bündelt der Browser die Ereignisse, und
  // die Messung beschriebe eine Eingabe, die niemand macht.
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(500); // die letzten Rahmen nachlaufen lassen

  const latenzen = await page.evaluate(
    () => (window as unknown as { __latenzen: number[] }).__latenzen,
  );
  expect(latenzen.length, 'keine Anschläge gemessen').toBeGreaterThanOrEqual(text.length - 2);
  const sortiert = [...latenzen].sort((a, b) => a - b);
  return {
    median: sortiert[Math.floor(sortiert.length / 2)],
    p90: sortiert[Math.floor(sortiert.length * 0.9)],
    schlechtester: sortiert[sortiert.length - 1],
    anzahl: sortiert.length,
  };
}

const TEXT = 'Lage unveraendert, Abschnitt wird fortgeschrieben.'.slice(0, ANSCHLAEGE);

// Erster Lauf zahlt den Vite-Kaltstart der Detailroute mit.
test.setTimeout(120_000);

test('Tippen im Lageberichtsentwurf: Verzögerung Anschlag-bis-Bild bei 1366 px', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Tippen LB ${Date.now()}`);
  const berichtId = await lageberichtAnlegen(page, einsatzId);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${berichtId}`);
  // Der Einstiegsfokus (LFH-495) sitzt im ersten leeren Abschnitt — am frischen Bericht
  // also im ersten. Damit ist das Ziel des Tippens dasselbe, das die Person vorfindet.
  const feld = page.getByRole('textbox', { name: 'Auftrag', exact: true });
  await expect(feld).toBeFocused();
  // Alle acht Editoren stehen im DOM (`forceRender`) — das ist die Voraussetzung des
  // Befundes, nicht ein Nebenumstand. `getByLabel`, nicht `getByRole`: ein zugeklapptes
  // Collapse-Panel liegt nicht im Zugänglichkeitsbaum, sein Feld hat dort also keinen
  // Namen — die Label-Verknüpfung findet es trotzdem (gemessen).
  await expect(page.getByLabel('Vorschlag der besten Möglichkeit')).toBeAttached();

  const lb = await tippverzoegerung(page, TEXT);

  // ── Kontrolle: derselbe Editor, dieselbe autoSize-Arbeit, aber ohne `Form.useWatch` ──
  const befehlId = await befehlAnlegen(page, einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/auftraege/befehle/${befehlId}`);
  await expect(page.getByRole('textbox', { name: 'Lage', exact: true })).toBeFocused();
  const bf = await tippverzoegerung(page, TEXT);

  const bericht =
    `[gemessen] 1366x768, ${lb.anzahl} Anschläge — Lagebericht (8 Editoren): `
    + `Median ${lb.median.toFixed(1)} ms, p90 ${lb.p90.toFixed(1)} ms, `
    + `schlechtester ${lb.schlechtester.toFixed(1)} ms · `
    + `Befehl (ohne useWatch, 5 Editoren): Median ${bf.median.toFixed(1)} ms, `
    + `p90 ${bf.p90.toFixed(1)} ms, schlechtester ${bf.schlechtester.toFixed(1)} ms`;
  console.log(bericht);
  test.info().annotations.push({ type: 'gemessen', description: bericht });

  // STRUKTUR, nicht Uhr: die Kontrolle muss schneller sein als die beobachtete Seite. Das
  // ist die einzige Aussage, die auch auf zwei geteilten Kernen trägt — sie würde auffallen,
  // wenn `useWatch` irgendwann ganz entfiele und dieser Test nichts mehr vergleicht. Kein
  // Schwellwert, nur die Richtung.
  expect(bf.median, `Kontrolle nicht schneller als die beobachtete Seite. ${bericht}`)
    .toBeLessThanOrEqual(lb.median);

  if (!LATENZ_GATE) return;
  expect(lb.p90, `p90 über dem Deckel — Memoisierung des Akkordeons aufgehoben? ${bericht}`)
    .toBeLessThanOrEqual(P90_MAX_MS);
  expect(lb.median, `Median über RAIL-Budget. ${bericht}`).toBeLessThanOrEqual(MEDIAN_MAX_MS);
  expect(lb.schlechtester, `schlechtester Anschlag weiter gewachsen. ${bericht}`)
    .toBeLessThanOrEqual(SCHLECHTESTER_MAX_MS);
});
