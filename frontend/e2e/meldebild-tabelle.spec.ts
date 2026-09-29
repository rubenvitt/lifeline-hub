import { expect, test, type Page } from '@playwright/test';

/**
 * Die Nachweise des Meldebilds, die NUR im Browser gehen (jsdom rechnet kein Layout und
 * wertet `@media print` nicht aus).
 *
 * NACHWEIS 1 — fixierte erste Spalte × Aufklapp-Symbol. Das Meldebild ist ein Statusraster
 * mit einer Zeile je Einheit und den Mitteln als aufklappbarem Detail. Die Bedien-Leitlinie
 * verbietet dort Karten, also MUSS das Aufklappen in der fixierten Tabelle bedienbar sein —
 * auch auf 390 px.
 *
 * NACHWEIS 2 — der Druckpfad durch den Bildlaufcontainer: die Neutralisierer in
 * `pages/kraefteuebersichtPrint.css` WIRKEN, nicht bloß „stehen da" (eine Regel mit
 * Tippfehler im Selektor steht auch da). Gemessen wird, dass der Inhalt bei A4-Breite
 * vollständig in der Druckwurzel liegt; nicht die Seitenhöhe. Kein echter Druckdialog —
 * `emulateMedia` liefert das Layout; den Knopf prüft NACHWEIS 2b mit einem `window.print`-Stub.
 *
 * Seeding per `page.request`: ein Meldebild ohne Zeilen hat keinen Baum und keinen
 * Bildlaufweg, jede Messung wäre grün durch Nichtstun.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Handschirm aus A1, Gate 1. Per `setViewportSize`: ein Device-Descriptor zöge webkit nach. */
const HANDSCHIRM = { width: 390, height: 844 };

/** Subpixel-Spielraum für JEDEN Maßvergleich. */
const SUBPIXEL = 0.5;

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

/**
 * Ad-hoc-Kräfte ohne Einheit erzeugen die Sammelzeile „Ohne Einheit" mit n Kindern — eine
 * Aufklapp-Ebene aus einem einzigen Endpunkt. ABSICHTLICH LANGE WERTE: die
 * Bezeichnungsspalte wächst mit dem Inhalt, sonst hätte die fixierte Spalte keinen
 * Bildlaufweg zu halten.
 */
async function seedeKraefte(page: Page, einsatzId: string, anzahl: number) {
  for (let i = 0; i < anzahl; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
      data: {
        adhoc: {
          name: `Kirchgassner-Wohlfahrt, Maximiliane ${i}`,
          funktion: 'Abschnittsleitung Technische Hilfeleistung',
          traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
        },
      },
    });
    expect(
      antwort.ok(),
      `Seeding Kraft ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }
}

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
