import { expect, test, type Page } from '@playwright/test';
import { SUBPIXEL, anmelden, einsatzAnlegen, seedeKraefte } from './meldebild-kern';

/**
 * Die Nachweise des Meldebilds am Bildschirm, die NUR im Browser gehen (jsdom rechnet kein
 * Layout).
 *
 * NACHWEIS 1 — fixierte erste Spalte × Aufklapp-Symbol. Das Meldebild ist ein Statusraster
 * mit einer Zeile je Einheit und den Mitteln als aufklappbarem Detail. Die Bedien-Leitlinie
 * verbietet dort Karten, also MUSS das Aufklappen in der fixierten Tabelle bedienbar sein —
 * auch auf 390 px.
 *
 * NACHWEIS 2 und 2b (Druckpfad durch den Bildlaufcontainer, Kopf und Körper in EINER Tabelle)
 * stehen in `meldebild-druck.spec.ts` und laufen dort auch in Firefox und WebKit (`DRUCK_SPECS`,
 * LFH-915).
 *
 * Seeding per `page.request`: ein Meldebild ohne Zeilen hat keinen Baum und keinen
 * Bildlaufweg, jede Messung wäre grün durch Nichtstun.
 */

/** Handschirm aus A1, Gate 1. Per `setViewportSize`: ein Device-Descriptor zöge webkit nach. */
const HANDSCHIRM = { width: 390, height: 844 };

/**
 * Maße des Aufklapp-Symbols der ersten Datenzeile, RELATIV zum Bildlaufcontainer — absolut
 * gemessen wanderte der Container zwischen zwei Messungen, und die Fixierung fiel grundlos
 * durch. Gemessen an der Körperzelle: mit `sticky` trennt antd Kopf und Körper.
 */
async function symbolLage(page: Page) {
  return page.evaluate(() => {
    const koerper = document.querySelector('.ant-table-body')!;
    const zeile = document.querySelector('tr.ant-table-row')!;
    const fix = zeile.querySelector('td.ant-table-cell-fix-start')!;
    const symbol = fix.querySelector('.ant-table-row-expand-icon')!;
    const nicht = zeile.querySelector('td:not(.ant-table-cell-fix-start)')!;
    const bezug = koerper.getBoundingClientRect().x;
    const s = symbol.getBoundingClientRect();
    return {
      symbolX: s.x - bezug,
      symbolBreite: s.width,
      symbolHoehe: s.height,
      nichtFixX: nicht.getBoundingClientRect().x - bezug,
      restweg: koerper.scrollWidth - koerper.clientWidth,
    };
  });
}

test('Meldebild bei 390 px: das Aufklapp-Symbol lebt in der fixierten Spalte, klappt auf und hält seine x-Position', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 8);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);

  const bereich = page.getByRole('region', { name: 'Meldebild' });
  await expect(bereich).toHaveCount(1);

  // (a) `form="tabelle"` wirkt: auf 390 px steht eine Tabelle, KEIN Kartenzweig
  //     (Prüflisten-Kriterium 14: eine Vergleichsfläche wird angepasst, nicht aufgelöst).
  await expect(page.locator('.ant-table')).toHaveCount(1);
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);

  // (b) Genau eine fixierte Kopfzelle, und sie ist wirklich `sticky`.
  const fixierte = page.locator('th.ant-table-cell-fix-start');
  await expect(fixierte).toHaveCount(1);
  await expect(fixierte).toHaveCSS('position', 'sticky');

  // (c) Die Sammelzeile steht, und das Raster startet ZUGEKLAPPT.
  await expect(page.getByText('Ohne Einheit', { exact: true })).toHaveCount(1);
  const zeilen = page.locator('tr.ant-table-row');
  await expect(zeilen).toHaveCount(1);

  // (d) Das Symbol liegt IN der fixierten Zelle (antd rendert den Auslöser in Spalte 0).
  //     JE ZEILE verengt: antd rendert auch an Blatt-Zeilen einen Platzhalter mit derselben
  //     Klasse, ein seitenweiter Locator bräche im strict mode.
  const symbolIn = (index: number) =>
    zeilen.nth(index).locator('td.ant-table-cell-fix-start .ant-table-row-expand-icon');
  const symbol = symbolIn(0);
  await expect(symbol).toHaveCount(1);

  // (e) FUNKTIONSHÄLFTE: `click()` prüft das Trefferziel; `toBeVisible` winkte ein Symbol
  //     durch, das rendert, aber nicht feuert.
  await symbol.click();
  await expect(zeilen, 'Aufklappen bringt die 8 gesäten Kräfte').toHaveCount(9);

  // AUFGEKLAPPT gemessen: erst die langen Personennamen geben den waagerechten Bildlaufweg.
  const vor = await symbolLage(page);
  // Vorbedingung: ohne Bildlaufweg wäre die Halte-Messung trivial grün.
  expect(
    vor.restweg,
    `Vorbedingung: das Meldebild braucht waagerechten Bildlaufweg (gemessen ${vor.restweg}px)`,
  ).toBeGreaterThan(50);

  // (f) HALTE-HÄLFTE nach echtem Bildlauf. Dazu „die nicht-fixierte Zelle ist gewandert",
  //     sonst wäre ein nicht ausgeführter Bildlauf grün.
  await page.locator('.ant-table-body').evaluate((el) => el.scrollTo(200, 0));
  const nach = await symbolLage(page);
  expect(nach.nichtFixX, 'nicht-fixierte Zelle muss mitwandern').toBeLessThan(vor.nichtFixX - 100);
  expect(
    Math.abs(nach.symbolX - vor.symbolX),
    `Aufklapp-Symbol hält seine x-Position (${vor.symbolX} → ${nach.symbolX})`,
  ).toBeLessThanOrEqual(1);

  // (g′) Der Platzhalter an einer Blatt-Zeile trägt ein `aria-label` („Zeile erweitern");
  //      ob er Fokusziel ist, entscheidet seine Sichtbarkeit. Protokolliert, nicht bewertet
  //      (antd-Bestand).
  const platzhalterSichtbarkeit = await symbolIn(1).evaluate(
    (el) => getComputedStyle(el).visibility,
  );

  // (h) …und wieder zu, WÄHREND die Tabelle verschoben ist.
  await symbol.click();
  await expect(zeilen, 'Zuklappen nimmt den ganzen Unterbaum mit').toHaveCount(1);

  // (i) Trefffläche des Symbols über die Dichtestufen — es ist der EINZIGE Auslöser des
  //     Baums. Protokolliert, nicht zugesichert: antd-Bestand, `Datensicht` setzt dort keine
  //     Höhe. Der Befund ist, ob es der Handschuh-Stufe folgt.
  const symbolKompakt = `${vor.symbolBreite}×${vor.symbolHoehe}`;
  await page.evaluate(() => window.localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  await expect(page.getByText('Ohne Einheit', { exact: true })).toHaveCount(1);
  const handschuh = await symbolLage(page);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Aufklapp-Symbol kompakt ${symbolKompakt}px, handschuh ` +
      `${handschuh.symbolBreite}×${handschuh.symbolHoehe}px, Restweg ${vor.restweg}px (390px), ` +
      `Blatt-Platzhalter visibility=${platzhalterSichtbarkeit}`,
  });
});

/**
 * NACHWEIS 3 — das Statusband bricht um, statt waagerecht zu scrollen. Gemessen bei 1024 px,
 * wo die Inhaltsbreite unter 950 px liegt (eigens zugesichert).
 *
 * Gesät werden Personal UND Einheiten mit je einem Fahrzeug, damit beide Gruppen stehen; weil
 * keine Einheit je zurückgemeldet hat, steht zusätzlich „keine Rückmeldung".
 */
test('Statusband des Meldebilds bricht um statt waagerecht zu scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `LFH-338 Kopf ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 4);
  for (let i = 0; i < 4; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/fahrzeuge`, {
      data: { adhoc: { funkrufname: `Florian Musterstadt-Nordwest 3/44-${i}` } },
    });
    expect(antwort.ok(), `Seeding Fahrzeug ${i}: ${antwort.status()}`).toBeTruthy();
    // Das Band zählt Einheiten — das Fahrzeug trägt den Status seiner Einheit.
    const ef = ((await antwort.json()) as { id: number }).id;
    const einheit = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, {
      data: { name: `Einsatzeinheit Musterstadt-Nordwest ${i}` },
    });
    expect(einheit.ok(), `Seeding Einheit ${i}: ${einheit.status()}`).toBeTruthy();
    const eid = ((await einheit.json()) as { id: number }).id;
    const zu = await page.request.put(
      `/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${ef}`,
    );
    expect(zu.ok(), `Zuordnung ${i}: ${zu.status()}`).toBeTruthy();
  }
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);

  const band = page.locator('[data-lfh="meldebild-statusband"]');
  await expect(band.getByRole('region', { name: 'Einheiten je Status' })).toBeVisible();
  await expect(band.getByRole('region', { name: 'Personal je Status' })).toBeVisible();

  const mass = await band.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    mass.clientWidth,
    `Messung soll auf höchstens 950 px Inhaltsbreite laufen (gemessen ${mass.clientWidth}px)`,
  ).toBeLessThanOrEqual(950);
  expect(
    mass.scrollWidth,
    `Band scrollt waagerecht: ${mass.scrollWidth}px Inhalt in ${mass.clientWidth}px Fläche`,
  ).toBeLessThanOrEqual(mass.clientWidth + SUBPIXEL);

  // Jede Zelle ohne Bildlauf erreichbar: ein Band, das eine Zelle gar nicht rendert, scrollt
  // ebenfalls nicht.
  const zellen = band.locator('[data-lfh="kennzahl"]');
  const anzahl = await zellen.count();
  expect(anzahl, 'mindestens eine Fahrzeug- und eine Personalzelle').toBeGreaterThanOrEqual(2);
  for (let i = 0; i < anzahl; i += 1) await expect(zellen.nth(i)).toBeInViewport();
  // Fugenraster: bei 1024 px drei Spalten, alle Gruppen in derselben Geometrie. Ein Band, das
  // nur einen Teil der Breite nutzte, hätte eine andere Spurzahl.
  const spuren = await band
    .locator('[data-lfh="kennzahlenband"]')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).gridTemplateColumns.split(' ')));
  // Drei Gruppen: „keine Rückmeldung" steht als eigene Gruppe daneben.
  await expect(band.getByRole('region', { name: 'Einheiten ohne Rückmeldung' })).toBeVisible();
  expect(spuren.map((s) => s.length)).toEqual([3, 3, 3]);
  expect(spuren[1], 'Personal in derselben Spaltengeometrie wie Fahrzeuge').toEqual(spuren[0]);
  expect(spuren[2], 'Rückmeldung in derselben Spaltengeometrie').toEqual(spuren[0]);
  // Und das Meta im Seitenkopf nennt Einheiten und Stärke in BOS-Schreibweise.
  await expect(
    page.locator('[data-lfh="seitenkopf"]').getByText(/Einheiten? · Stärke \d+\/\d+\/\d+\/\/\d+/),
  ).toBeInViewport();

  test.info().annotations.push({
    type: 'messwert',
    description: `Statusband bei 1024px Sichtfeld: Inhaltsbreite ${mass.clientWidth}px, Inhalt ${mass.scrollWidth}px, ${anzahl} Zellen`,
  });
});
