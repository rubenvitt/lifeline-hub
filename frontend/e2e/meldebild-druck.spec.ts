import { expect, test, type Page } from '@playwright/test';
import { SUBPIXEL, anmelden, einsatzAnlegen, seedeKraefte } from './meldebild-kern';

/**
 * Druck des Meldebilds: die Nachweise, die NUR im Browser gehen (jsdom rechnet kein Layout und
 * wertet `@media print` nicht aus). Chromium, Firefox und WebKit prüfen sie unter Druckmedium
 * (`DRUCK_SPECS`, LFH-915); ein PDF erzeugt diese Spec nicht, sie braucht deshalb keinen
 * Chromium-Zweig. Den echten Seitenumbruch und die Kopfwiederholung auf dem Blatt zeigt nur der
 * Druck selbst (Prüfliste LFH-22, Handprüfung).
 *
 * NACHWEIS 2 — der Druckpfad durch den Bildlaufcontainer: die Neutralisierer in
 * `druck/druck.css` (seit LFH-548 dort, vorher `pages/kraefteuebersichtPrint.css`) WIRKEN,
 * nicht bloß „stehen da" (eine Regel mit Tippfehler im Selektor steht auch da). Gemessen wird, dass der Inhalt bei A4-Breite
 * vollständig in der Druckwurzel liegt; nicht die Seitenhöhe. Kein echter Druckdialog —
 * `emulateMedia` liefert das Layout; den Knopf prüft NACHWEIS 2b mit einem `window.print`-Stub.
 *
 * Mutationsprobe (LFH-915): `thead` in `druck/druck.css` auf `table-row-group` statt
 * `table-header-group` → NACHWEIS 2b ist in Chromium, Firefox und WebKit rot. Die Regel bloß zu
 * streichen ist keine Probe: `table-header-group` ist schon der Vorgabewert der Browser.
 *
 * Seeding per `page.request`: ein Meldebild ohne Zeilen hat keinen Baum und keinen
 * Bildlaufweg, jede Messung wäre grün durch Nichtstun.
 */

/**
 * Computed-Style- und Geometriewerte des Meldebilds im aktuellen Medium, per `evaluate` —
 * `toBeVisible` sagt über `overflow`/`position`/`display` nichts. Gelesen werden nur Knoten
 * innerhalb der Druckwurzel.
 */
async function druckLage(page: Page) {
  return page.evaluate(() => {
    const wurzel = document.querySelector('.kraefte-print-root')!;
    const koerper = document.querySelector('.ant-table-body')!;
    const halter = document.querySelector('.ant-table-sticky-holder');
    const werkzeuge = document.querySelector('[data-lfh="datensicht-werkzeuge"]')!;
    const fixZelle = document.querySelector('tr.ant-table-row td.ant-table-cell-fix-start')!;
    // Die erste DATENZEILE: antd schiebt bei `scroll.x` eine `ant-table-measure-row` voran.
    const zellen = Array.from(
      document.querySelector('tr.ant-table-row')!.querySelectorAll(':scope > td'),
    ) as HTMLElement[];
    const letzte = zellen[zellen.length - 1];
    const w = wurzel.getBoundingClientRect();
    return {
      wurzelRechts: w.right,
      wurzelBreite: w.width,
      letzteRechts: letzte.getBoundingClientRect().right,
      letzteSpalten: zellen.length,
      koerperUeberhang: koerper.scrollWidth - koerper.clientWidth,
      koerperOverflowX: getComputedStyle(koerper).overflowX,
      halterPosition: halter ? getComputedStyle(halter).position : 'kein Halter',
      fixPosition: getComputedStyle(fixZelle).position,
      werkzeugeDisplay: getComputedStyle(werkzeuge).display,
    };
  });
}

/**
 * A4-Hochformat, nutzbare Breite in CSS-Pixeln. `emulateMedia` schaltet nur die
 * Medienabfrage, die Layoutbreite bleibt die des Sichtfelds — ein Druck-Layoutbeweis muss das
 * Sichtfeld auf die Papierbreite stellen.
 *
 * [abgeleitet]: 210 mm ÷ 25,4 × 96 = 793,7 px minus 2 × 15 mm `@page`-Rand (113,4 px)
 * = 680,3 px, abgerundet — dieselbe Zahl wie `NUTZ_BREITE` in `druck-fluss.spec.ts`. Bei
 * 390 px Sichtfeld ragt die Tabelle heraus; das ist kein Druckbefund.
 */
const A4_DRUCKBREITE = 680;

test('Druckpfad des Meldebilds: die Neutralisierer WIRKEN, und keine Spalte ragt aus dem Druck-Wurzelknoten', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Druck ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 8);

  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  await expect(page.getByText('Ohne Einheit', { exact: true })).toHaveCount(1);

  // Aufklappen über das Symbol: erst die Mittelzeilen erzeugen mit ihren langen Namen den Überhang.
  const zeilen = page.locator('tr.ant-table-row');
  const symbolIn = (index: number) =>
    zeilen.nth(index).locator('td.ant-table-cell-fix-start .ant-table-row-expand-icon');
  await expect(zeilen).toHaveCount(1);
  await symbolIn(0).click();
  await expect(zeilen).toHaveCount(9);

  // ── GEGENPROBE `screen`: die Enge ist echt, der Container schneidet wirklich ab.
  const bildschirm = await druckLage(page);
  expect(
    bildschirm.koerperUeberhang,
    `Vorbedingung: am Bildschirm muss der Bildlaufcontainer echten Überhang tragen (gemessen ${bildschirm.koerperUeberhang}px)`,
  ).toBeGreaterThan(50);
  expect(bildschirm.werkzeugeDisplay, 'Werkzeugzeile steht am Bildschirm').not.toBe('none');
  expect(bildschirm.halterPosition, 'Kopfhalter steht am Bildschirm auf sticky').toBe('sticky');
  expect(bildschirm.fixPosition, 'Kennungsspalte steht am Bildschirm auf sticky').toBe('sticky');

  // ── DRUCKMEDIUM
  await page.emulateMedia({ media: 'print' });
  const druck = await druckLage(page);

  // (a) DIE NEUTRALISIERER WIRKEN — vier Regeln, vier gemessene Umschläge.
  expect(druck.koerperOverflowX, 'Bildlaufcontainer im Druck auf visible').toBe('visible');
  expect(druck.halterPosition, 'Kopfhalter im Druck auf static').toBe('static');
  expect(druck.fixPosition, 'Kennungsspalte im Druck auf static').toBe('static');
  expect(druck.werkzeugeDisplay, 'Werkzeugzeile im Druck ausgeblendet').toBe('none');

  // (b) DIE NUTZLAST, zwei Hälften: der Bildlaufcontainer hält keinen Inhalt mehr zurück
  //     (die diskriminierende Hälfte — auf Papier wäre verborgener Inhalt weg), und die
  //     LETZTE Spaltenzelle liegt vollständig in der Druckwurzel.
  expect(
    druck.koerperUeberhang,
    `im Druck darf nichts mehr im Bildlauf verborgen liegen (gemessen ${druck.koerperUeberhang}px Überhang bei ${druck.letzteSpalten} Spalten)`,
  ).toBeLessThanOrEqual(1);
  expect(
    druck.letzteRechts,
    `letzte Spaltenzelle ragt aus dem Druck-Wurzelknoten (Zelle rechts ${druck.letzteRechts}px, Wurzel rechts ${druck.wurzelRechts}px, Wurzel ${druck.wurzelBreite}px breit)`,
  ).toBeLessThanOrEqual(druck.wurzelRechts + SUBPIXEL);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Druck bei ${A4_DRUCKBREITE}px (A4 hoch, nutzbar): Wurzel ${Math.round(druck.wurzelBreite)}px, ` +
      `letzte Zelle rechts ${Math.round(druck.letzteRechts)}px, ${druck.letzteSpalten} Spalten, ` +
      `Überhang screen ${bildschirm.koerperUeberhang}px → print ${druck.koerperUeberhang}px`,
  });

  // Medium zurückstellen, damit ein Folgeschritt nicht im Druckmodus weiterläuft.
  await page.emulateMedia({ media: null });
});

/**
 * NACHWEIS 2b — im Druck steht der Tabellenkopf in DERSELBEN Tabelle wie der Körper. Mit
 * `sticky` legt rc-table den Kopf in einen eigenen Halter, und die Kopfwiederholung je Blatt
 * griffe nicht; das Primitiv schaltet `sticky` bei `beforeprint` ab (`useDruckModus`).
 *
 * Weder `emulateMedia` noch `page.pdf()` feuern `beforeprint`; geprüft werden beide
 * Betriebswege: der KNOPF (Stub für `window.print`, der wie der Browser synchron
 * `beforeprint` feuert — belegt zugleich, dass `useDrucken` außerhalb des React-Effekts
 * druckt) und Strg+P (`dispatchEvent`). Nach `afterprint` steht der Kopf wieder im Halter.
 * Die Wiederholung auf dem PDF-Blatt selbst ist nicht belegt (PDF-Text komprimiert).
 */
async function kopfLage(page: Page) {
  return page.evaluate(() => {
    const wurzel = document.querySelector('[data-lfh="druckwurzel"]')!;
    const mitZeilen = Array.from(wurzel.querySelectorAll('table')).filter(
      (t) => t.querySelector('tbody tr.ant-table-row') !== null,
    );
    const kopf = mitZeilen[0]?.querySelector('thead');
    const seitenkopf = wurzel.querySelector('[data-lfh="seitenkopf"]');
    const druckkopf = wurzel.querySelector('[data-lfh="druckkopf"]');
    return {
      tabellenMitZeilen: mitZeilen.length,
      koerperHatKopf: kopf != null,
      kopfDisplay: kopf ? getComputedStyle(kopf).display : 'kein thead',
      halter: wurzel.querySelector('.ant-table-sticky-holder') != null,
      seitenkopf: seitenkopf ? getComputedStyle(seitenkopf).display : 'fehlt',
      druckkopf: druckkopf ? getComputedStyle(druckkopf).display : 'fehlt',
      zeilen: wurzel.querySelectorAll('tr.ant-table-row').length,
    };
  });
}

test('Druck des Meldebilds: Kopf und Körper in EINER Tabelle, kein Seitenkopf — über den Knopf und über Strg+P', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Kopf ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 8);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(1);

  // Vorbedingung am Bildschirm: Kopf im Halter, Körper ohne `thead`.
  const schirm = await kopfLage(page);
  expect(schirm.halter, 'Vorbedingung: stehende Kopfzeile am Bildschirm').toBe(true);
  expect(schirm.koerperHatKopf, 'Vorbedingung: Körpertabelle ohne eigenen Kopf').toBe(false);

  // ── KNOPF: der Stub hält den DOM-Stand IM Moment von `beforeprint` fest — später gemessen,
  // wäre ein liegengebliebenes Update bis dahin nachgerendert.
  await page.evaluate(() => {
    const w = window as unknown as { gedruckt: number; halterBeimDruck: boolean[] };
    w.gedruckt = 0;
    w.halterBeimDruck = [];
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      w.halterBeimDruck.push(
        document.querySelector('[data-lfh="druckwurzel"] .ant-table-sticky-holder') != null,
      );
      w.gedruckt += 1;
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { gedruckt: number }).gedruckt))
    .toBe(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { halterBeimDruck: boolean[] }).halterBeimDruck,
    ),
    'Knopf: im Moment des Druckbilds steht kein Sticky-Halter mehr',
  ).toEqual([false]);
  await page.emulateMedia({ media: 'print' });
  const knopf = await kopfLage(page);
  expect(knopf.halter, 'Knopf: kein Sticky-Halter im Druck').toBe(false);
  expect(knopf.tabellenMitZeilen, 'Knopf: genau eine Tabelle mit Datenzeilen').toBe(1);
  expect(knopf.koerperHatKopf, 'Knopf: Körpertabelle trägt ihren Kopf').toBe(true);
  expect(knopf.kopfDisplay, 'Knopf: Kopf wiederholt sich je Blatt').toBe('table-header-group');
  expect(knopf.zeilen, 'Knopf: „vorbereiten" hat die Mittel aufgeklappt').toBe(9);
  expect(knopf.seitenkopf, 'Seitenkopf im Druck ausgeblendet').toBe('none');
  expect(knopf.druckkopf, 'Druckkopf steht auf Papier').not.toBe('none');

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: null });
  await expect.poll(async () => (await kopfLage(page)).halter).toBe(true);

  // ── Strg+P: der Browser feuert `beforeprint` selbst.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  const strgP = await kopfLage(page);
  expect(strgP.halter, 'Strg+P: kein Sticky-Halter im Druck').toBe(false);
  expect(strgP.koerperHatKopf, 'Strg+P: Körpertabelle trägt ihren Kopf').toBe(true);
  expect(strgP.kopfDisplay).toBe('table-header-group');
  expect(strgP.seitenkopf).toBe('none');

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: null });
  const danach = await kopfLage(page);
  expect(danach.halter, 'nach afterprint steht die Kopfzeile wieder (LFH-330)').toBe(true);
  expect(danach.koerperHatKopf).toBe(false);
});
