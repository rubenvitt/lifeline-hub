import { expect, test, type Page } from '@playwright/test';
import { baumLage, pruefeHaengendenEinzug } from './baum-einzug-kern';
import { SUBPIXEL, anmelden, einsatzAnlegen, seedeKraefte } from './meldebild-kern';
import { wechsleZuRolle } from './rollen-kern';

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
 * Derselbe Baum-Zweig wie der Funkplan (LFH-977): die Kräfte unter „Ohne Einheit“ stehen rechts
 * von ihrer Sammelzeile, auch mit langen Namen, auf dem Handschirm und am Desktop.
 */
test('Meldebild: der Baum-Einzug hält bei langen Namen, 390 und 1440 px', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Einzug ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 3);
  for (const viewport of [HANDSCHIRM, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
    const zeilen = page.getByRole('region', { name: 'Meldebild' }).locator('tr.ant-table-row');
    await expect(zeilen).toHaveCount(1);
    await zeilen.first().locator('.ant-table-row-expand-icon').click();
    await expect(zeilen, 'Aufklappen bringt die 3 gesäten Kräfte').toHaveCount(4);
    const lage = await baumLage(page, '[aria-label="Meldebild"]');
    expect(lage.filter((z) => z.ebene === 1)).toHaveLength(3);
    pruefeHaengendenEinzug(lage, `Meldebild ${viewport.width} px`, 'inhalt');
  }
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

/**
 * NACHWEIS 4 — Rückmeldung und Auftrag im Bild (LFH-973). Am Desktop 1440 lagen beide Spalten
 * hinter Funkrufname, Seit, Im Einsatz und Mittel, also erst nach waagerechtem Scrollen; die
 * Tönung einer Problemzeile hatte so keinen sichtbaren Grund. Gemessen wird die Kopfzelle gegen
 * den sichtbaren Bereich des Bildlaufcontainers, als Admin und als Führungspersonal (LFH-435).
 * Beide lesen Meldungen; den Zweig ohne Leserecht (403, die Rückmeldungsspalte entfällt) erzwingt
 * ein dritter Durchgang per `page.route`, dort muss der Auftrag allein im Bild stehen.
 *
 * Bei 1440 (Desktop) und 1366 (Fükw-Hauptgerät) scrollt die Tabelle gar nicht; bei 1180
 * (Tablet quer) darf sie scrollen, beide Köpfe stehen aber im Bild.
 */
const SPALTEN_SCHIRME = [
  { breite: 1440, ohneQuerscrollen: true },
  { breite: 1366, ohneQuerscrollen: true },
  { breite: 1180, ohneQuerscrollen: false },
];

test('Meldebild bei 1440 px: Rückmeldung und Auftrag ohne Querscrollen im Bild, Admin und Führungspersonal', async ({
  page,
}) => {
  // Drei Durchgänge zu je drei Schirmen, jeder mit frischem `goto`.
  test.setTimeout(120_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Meldebild Spalten ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 2);
  // Lange Einheitennamen: die Einheit ist die Fließspalte und darf die Tabelle nicht aufweiten.
  for (let i = 0; i < 3; i += 1) {
    const fahrzeug = await page.request.post(`/api/einsaetze/${einsatzId}/fahrzeuge`, {
      data: { adhoc: { funkrufname: `Florian Musterstadt-Nordwest 3/44-${i}` } },
    });
    expect(fahrzeug.ok(), `Seeding Fahrzeug ${i}: ${fahrzeug.status()}`).toBeTruthy();
    const ef = ((await fahrzeug.json()) as { id: number }).id;
    const einheit = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, {
      data: { name: `Sanitätsgruppe Musterstadt-Nordwest ${i}` },
    });
    expect(einheit.ok(), `Seeding Einheit ${i}: ${einheit.status()}`).toBeTruthy();
    const eid = ((await einheit.json()) as { id: number }).id;
    const zu = await page.request.put(
      `/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${ef}`,
    );
    expect(zu.ok(), `Zuordnung ${i}: ${zu.status()}`).toBeTruthy();
  }

  const pruefe = async (wer: string, rueckmeldungErwartet: boolean) => {
    for (const { breite, ohneQuerscrollen } of SPALTEN_SCHIRME) {
      await page.setViewportSize({ width: breite, height: 900 });
      await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
      const bereich = page.getByRole('region', { name: 'Meldebild' });
      await expect(bereich.locator('tr.ant-table-row')).toHaveCount(4);
      const kopf = (name: string) => bereich.getByRole('columnheader', { name, exact: true });
      // Gepollt: solange der Abruf läuft, steht die Spalte, erst die 403 nimmt sie weg.
      await expect(kopf('Rückmeldung'), `${wer}: Rückmeldungsspalte`).toHaveCount(
        rueckmeldungErwartet ? 1 : 0,
      );
      const rueckmeldung = rueckmeldungErwartet;
      const ort = `${wer} ${breite}px`;
      for (const name of rueckmeldung ? ['Auftrag', 'Rückmeldung'] : ['Auftrag']) {
        const lage = await kopf(name).evaluate((th) => {
          const huelle = th.closest('.ant-table-container')!;
          const bild = (huelle.querySelector('.ant-table-body') ??
            huelle.querySelector('.ant-table-content'))!;
          const b = bild.getBoundingClientRect();
          const k = th.getBoundingClientRect();
          return {
            links: k.left - b.left,
            rechts: k.right - b.left,
            sichtbar: bild.clientWidth,
            restweg: bild.scrollWidth - bild.clientWidth,
          };
        });
        expect(lage.links, `${ort}: Kopf „${name}“ links im Bild`).toBeGreaterThanOrEqual(
          -SUBPIXEL,
        );
        expect(
          lage.rechts,
          `${ort}: Kopf „${name}“ endet bei ${lage.rechts}px, sichtbar sind ${lage.sichtbar}px`,
        ).toBeLessThanOrEqual(lage.sichtbar + SUBPIXEL);
        if (ohneQuerscrollen) {
          expect(
            lage.restweg,
            `${ort}: die Tabelle scrollt waagerecht (${lage.restweg}px)`,
          ).toBeLessThanOrEqual(SUBPIXEL);
        }
        await expect(kopf(name)).toBeInViewport({ ratio: 1 });
        test.info().annotations.push({
          type: 'messwert',
          description: `${ort}: „${name}“ ${Math.round(lage.links)}–${Math.round(lage.rechts)} von ${lage.sichtbar}px, Restweg ${lage.restweg}px`,
        });
      }
    }
  };

  await pruefe('Admin', true);
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);
  await pruefe('Führungspersonal', true);
  await page.route('**/meldungen/rueckmeldungen', (route) =>
    route.fulfill({ status: 403, json: { fehler: 'keine Berechtigung' } }),
  );
  await pruefe('Führungspersonal ohne Leserecht auf Meldungen', false);
});
