import { expect, test, type Page } from '@playwright/test';

/**
 * Tippverzögerung im Lageberichtsentwurf am Fükw-Maß. `Form.useWatch([], form)` in
 * `LageberichtDetailPage` lässt die Seite je Anschlag neu rendern; ohne Memoisierung des
 * `AbschnittsAkkordeon` renderten auch die acht Editoren mit ihrer `autoSize`-Nachmessung mit.
 * jsdom führt `autoSize` nicht aus — deshalb hier.
 *
 * GEMESSEN WIRD DIE VERZÖGERUNG BIS ZUM BILD: je `keydown` ein Zeitstempel, abgelesen im
 * zweiten `requestAnimationFrame` danach (hinter dem Paint). Eine `performance.now()`-Klammer
 * um den Anschlag ließe Layout und Paint draußen.
 *
 * DER BEFEHLSENTWURF IST DIE KONTROLLE: dieselben Editoren mit `autoSize`, aber ohne
 * `Form.useWatch`. Der Unterschied ist der Preis der Beobachtung.
 *
 * KEINE ZEITSCHWELLE IN DER CI: auf dem GitHub-Runner (2 vCPU, zwei Worker) waren p90 und das
 * Verhältnis zur Kontrolle so verrauscht, dass „behoben" und „nicht behoben" überlappten. Die
 * Zusicherung steht deterministisch in `lageberichte/AbschnittsAkkordeon.test.tsx` (Zählung
 * der `editor`-Render-Prop). Hier bleiben die Messung samt Struktur-Vorbedingungen und die
 * Zahlen in Log und Annotation; die RAIL-Deckel gelten nur mit `PW_LATENZ=1` auf ruhiger
 * Hardware.
 *
 * OFFEN: der schlechteste Anschlag liegt bei 120–130 ms, über der RAIL-Grenze von 100 ms, und
 * hängt nicht an `useWatch` (Verdacht: `autoSize`-Neumessung beim Zeilenumbruch, die auch die
 * Kontrolle hebt). Eigene Untersuchung.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Die RAIL-Deckel gelten nur mit `PW_LATENZ=1` — auf ruhiger Hardware, von Hand. */
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
 * Tippt in das fokussierte Feld und liest je Anschlag die Verzögerung bis zum Bild. Der
 * Beobachter hängt am Dokument (`capture`) und hält damit auch, wenn ein Umbau das Feld
 * austauscht.
 */
async function tippverzoegerung(page: Page, text: string): Promise<Messung> {
  await page.evaluate(() => {
    const fenster = window as unknown as { __latenzen: number[] };
    fenster.__latenzen = [];
    document.addEventListener(
      'keydown',
      () => {
        const start = performance.now();
        // Zwei Rahmen: der erste läuft VOR dem Paint des laufenden Rahmens, der zweite danach.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            fenster.__latenzen.push(performance.now() - start);
          }),
        );
      },
      { capture: true },
    );
  });

  // 30 ms Abstand ≈ schnelles Schreiben; ohne Abstand bündelte der Browser die Ereignisse.
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

test('Tippen im Lageberichtsentwurf: Verzögerung Anschlag-bis-Bild bei 1366 px', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Tippen LB ${Date.now()}`);
  const berichtId = await lageberichtAnlegen(page, einsatzId);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${berichtId}`);
  // Der Einstiegsfokus sitzt am frischen Bericht im ersten Abschnitt — das Ziel, das die
  // Person vorfindet.
  const feld = page.getByRole('textbox', { name: 'Auftrag', exact: true });
  await expect(feld).toBeFocused();
  // Alle acht Editoren stehen im DOM (`forceRender`) — die Voraussetzung des Befundes.
  // `getByLabel`, nicht `getByRole`: ein zugeklapptes Collapse-Panel liegt nicht im
  // Zugänglichkeitsbaum.
  await expect(page.getByLabel('Vorschlag der besten Möglichkeit')).toBeAttached();

  const lb = await tippverzoegerung(page, TEXT);

  // ── Kontrolle: derselbe Editor, dieselbe autoSize-Arbeit, aber ohne `Form.useWatch` ──
  const befehlId = await befehlAnlegen(page, einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/auftraege/befehle/${befehlId}`);
  await expect(page.getByRole('textbox', { name: 'Lage', exact: true })).toBeFocused();
  const bf = await tippverzoegerung(page, TEXT);

  const bericht =
    `[gemessen] 1366x768, ${lb.anzahl} Anschläge — Lagebericht (8 Editoren): ` +
    `Median ${lb.median.toFixed(1)} ms, p90 ${lb.p90.toFixed(1)} ms, ` +
    `schlechtester ${lb.schlechtester.toFixed(1)} ms · ` +
    `Befehl (ohne useWatch, 5 Editoren): Median ${bf.median.toFixed(1)} ms, ` +
    `p90 ${bf.p90.toFixed(1)} ms, schlechtester ${bf.schlechtester.toFixed(1)} ms`;
  console.log(bericht);
  test.info().annotations.push({ type: 'gemessen', description: bericht });

  // STRUKTUR, nicht Uhr: die Kontrolle muss schneller sein als die beobachtete Seite — nur die
  // Richtung, kein Schwellwert; sie fiele auf, wenn `useWatch` ganz entfiele.
  expect(
    bf.median,
    `Kontrolle nicht schneller als die beobachtete Seite. ${bericht}`,
  ).toBeLessThanOrEqual(lb.median);

  if (!LATENZ_GATE) return;
  expect(
    lb.p90,
    `p90 über dem Deckel — Memoisierung des Akkordeons aufgehoben? ${bericht}`,
  ).toBeLessThanOrEqual(P90_MAX_MS);
  expect(lb.median, `Median über RAIL-Budget. ${bericht}`).toBeLessThanOrEqual(MEDIAN_MAX_MS);
  expect(
    lb.schlechtester,
    `schlechtester Anschlag weiter gewachsen. ${bericht}`,
  ).toBeLessThanOrEqual(SCHLECHTESTER_MAX_MS);
});
