import { expect, test, type Page } from '@playwright/test';
import {
  anmeldenOhneStartseite,
  einsatzMitLage,
  grundlageOhneNetz,
  lagekarteBereit,
  logoSetzen,
  zonenAnlegen,
} from './lageplan-kern';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Lagekarte als Lageplan drucken (LLH-1051, Spec `lagekarte-druck`), was nur der Browser zeigt:
 * das Bild kommt aus der WebGL-Leinwand (ohne `preserveDrawingBuffer`), das Blatt steht A4 quer
 * mit Druckkopf, Maßstab, Nordpfeil und Legende, und eine gesperrte Ebene fehlt auf beidem.
 * Chromium und WebKit prüfen Aufnahme und Mechanik unter Druckmedium; das PDF (Seitenformat, ein
 * Blatt) gibt es nur in Chromium. Firefox fährt diese Spec nicht (`playwright.config.ts`,
 * `KARTEN_DRUCK_SPECS`): headless hat er hier und in der CI kein WebGL2, die Lagekarte entsteht
 * dort gar nicht.
 *
 * Angemeldet wird über die API (`anmeldenOhneStartseite`): die erste Seite ist die Lagekarte, kein
 * `goto` bricht Abrufe einer anderen Seite ab, die WebKit sonst als Seitenfehler meldet.
 *
 * Mutationsproben: `page: lageplan` in `lageplanDruck.css` weg → das Blatt ist A4 hoch, rot;
 * Aufnahme ohne `once('render')` (direkt `toBlob`) → leere Leinwand, das Bild ist einfarbig, rot;
 * Legende aus den Schaltern statt aus dem Gezeichneten → „Abschnitte“ steht da, rot; festes
 * Bildmaß statt Vermessen (`LageplanDruck.tsx` ohne `setBildHoeheMm`) → mit Logo und langer
 * Legende bleibt das Bild 95 mm hoch, rot (geprobt 20.10.).
 */

const FUEKW = { width: 1366, height: 768 };
/** Seitenmaße in Punkt, ± 2 pt Rundung von Chromium. */
const A4_QUER = { breite: 841.89, hoehe: 595.28 };

/** Druck wie die Person: der Knopf löst `beforeprint` aus (`emulateMedia` feuert es nicht). */
async function drucke(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __lfhDrucke: number };
    w.__lfhDrucke = 0;
    window.print = () => {
      w.__lfhDrucke += 1;
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __lfhDrucke: number }).__lfhDrucke))
    .toBe(1);
  await page.emulateMedia({ media: 'print' });
}

const PX_JE_MM = 96 / 25.4;

/** Gedrucktes Bild und Maßstab unter Druckmedium: Bildmaße, Länge der Leiste, Maßstabszahl. */
async function gedruckterMassstab(page: Page) {
  return page.locator('[data-lfh="druckwurzel"]').evaluate((w) => {
    const bild = w.querySelector('[data-lfh="lageplan-bild"]')!.getBoundingClientRect();
    const leiste = w.querySelector('[data-lfh="lageplan-massstab"] svg')!.getBoundingClientRect();
    return {
      zahlText: w.querySelector<HTMLElement>('[data-lfh="lageplan-verhaeltnis"]')!.innerText,
      leisteText: w.querySelector<HTMLElement>('[data-lfh="lageplan-massstab"]')!.innerText,
      bildBreitePx: bild.width,
      bildHoehePx: bild.height,
      leisteBreitePx: leiste.width,
    };
  });
}

/** Anteil verschiedener Farben im Bild: eine leere Leinwand ist einfarbig. */
function bildInhalt(page: Page) {
  return page.locator('[data-lfh="lageplan-bild"]').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const b = await createImageBitmap(img);
    const leinwand = new OffscreenCanvas(b.width, b.height);
    const k = leinwand.getContext('2d')!;
    k.drawImage(b, 0, 0);
    const { data } = k.getImageData(0, 0, b.width, b.height);
    const farben = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) {
      farben.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return { breite: b.width, hoehe: b.height, farben: farben.size };
  });
}

test('Lageplan: Ausschnitt als Bild, A4 quer mit Kopf, Maßstab, Nordpfeil und Legende ohne gesperrte Ebene', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await page.setViewportSize(FUEKW);
  await grundlageOhneNetz(page);
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzMitLage(page, `E2E Lageplan Druck ${Date.now()}`);
  await lagekarteBereit(page, einsatzId);

  // Ohne Knopf keine Druckwurzel: ein Strg+P druckt nie ein altes Bild.
  await expect(page.locator('[data-lfh="druckwurzel"]')).toHaveCount(0);
  await drucke(page);

  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  await expect(wurzel).toBeVisible();
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toContainText('Lageplan');
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toContainText('Kartengrundlage');
  const inhalt = await bildInhalt(page);
  test.info().annotations.push({
    type: 'messwert',
    description: `Bild ${inhalt.breite}×${inhalt.hoehe} px, ${inhalt.farben} Farben (Stichprobe)`,
  });
  expect(inhalt.farben, 'die Leinwand ist gezeichnet, nicht leer').toBeGreaterThan(3);
  await expect(wurzel.locator('[data-lfh="lageplan-massstab"]')).toHaveText(/^\d+ k?m$/);
  await expect(wurzel.locator('[data-lfh="lageplan-verhaeltnis"]')).toHaveText(
    /^Maßstab ca\. 1 : [\d.]+$/,
  );
  await expect(wurzel.getByRole('img', { name: 'Norden' })).toBeVisible();

  const legende = wurzel.locator('[data-lfh="lageplan-legende"]');
  await expect(legende.getByRole('listitem')).toContainText(['Einheiten (1)']);
  // Die Warnstufe steht als Text an der Zone (LFH-357), nicht nur als Farbe.
  await expect(legende.getByRole('listitem').filter({ hasText: /^Brandstelle · \S/ })).toHaveCount(
    1,
  );
  // Das Modul Einsatzabschnitte ist ausgeblendet: keine Zeile, obwohl eine Fläche besteht.
  await expect(legende).not.toContainText('Abschnitte');

  // Am Blatt hängt nichts von der Bedienung: die Karte selbst ist ausgeblendet.
  await expect(page.getByTestId('kartenflaeche')).toBeHidden();

  if (page.context().browser()?.browserType().name() === 'chromium') {
    const seiten = await pdfAuszug(
      await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }),
    );
    test.info().annotations.push({
      type: 'messwert',
      description: seiten
        .map((s) => `${Math.round(s.breite)}×${Math.round(s.hoehe)} pt, ${s.bilder.length} Bilder`)
        .join(' · '),
    });
    expect(seiten, 'der Lageplan ist ein Blatt').toHaveLength(1);
    const [blatt] = seiten;
    expect(Math.abs(blatt.breite - A4_QUER.breite), 'A4 quer').toBeLessThan(2);
    expect(Math.abs(blatt.hoehe - A4_QUER.hoehe), 'A4 quer').toBeLessThan(2);
    expect(blatt.text).toContain('Legende');
    expect(blatt.bilder.length, 'das Kartenbild steht auf dem Blatt').toBeGreaterThan(0);
  } else {
    test.info().annotations.push({ type: 'nur-chromium', description: 'Seitenformat im PDF' });
  }
  await page.emulateMedia({ media: null });

  // Nach dem Druck geht das Blatt wieder.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(wurzel).toHaveCount(0);
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test('Lageplan ohne Kacheln: gedruckt wird trotzdem, fehlende Kacheln bleiben leere Fläche', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await page.setViewportSize(FUEKW);
  await grundlageOhneNetz(page, { kacheln: false });
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzMitLage(page, `E2E Lageplan ohne Kacheln ${Date.now()}`);
  await lagekarteBereit(page, einsatzId);
  await drucke(page);
  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  await expect(wurzel.locator('[data-lfh="lageplan-bild"]')).toBeVisible();
  await expect(wurzel.locator('[data-lfh="lageplan-legende"]')).toContainText('Einheiten (1)');
  await expect(page.getByText('Lageplan nicht gedruckt')).toHaveCount(0);
  await page.emulateMedia({ media: null });
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test('Lageplan mit hohem Kopf und langer Legende: das Bild wird kleiner, alles bleibt auf einem Blatt', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await page.setViewportSize(FUEKW);
  await grundlageOhneNetz(page);
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  // Höher als gemessen: Logo im Kopf (wie nach `druck-fluss` in derselben Datenbank), eine
  // Einsatzbezeichnung über zwei Zeilen und 15 weitere Zonen in der Legende (17 Zeilen). Mit dem
  // festen Bild von 95 mm stand die Legende so auf einem zweiten Blatt.
  await logoSetzen(page);
  const einsatzId = await einsatzMitLage(
    page,
    `E2E Lageplan langer Kopf ${Date.now()} – Hochwasser an der Neckarschleife zwischen ` +
      'Unterdorf und Oberstadt, Deichverteidigung, Evakuierung der Uferstraße und Betreuung',
  );
  await zonenAnlegen(page, einsatzId, 15);
  await lagekarteBereit(page, einsatzId);
  await drucke(page);

  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  await expect(wurzel.locator('[data-lfh="druckkopf"] img')).toHaveCount(1);
  const legende = wurzel.locator('[data-lfh="lageplan-legende"]');
  await expect(legende.getByRole('listitem')).toHaveCount(17);
  await expect(legende).toContainText('Zone 15');

  // Das kleinere Bild ist in sich stimmig: die Leiste bleibt ein Anteil der gedruckten Bildbreite
  // (höchstens ein Viertel), und die Zahl passt zu ihr (`massstabZahl` rundet auf zwei Stellen).
  const gedruckt = await gedruckterMassstab(page);
  const breiteMm = gedruckt.bildBreitePx / PX_JE_MM;
  const zahl = Number(/1 : ([\d.]+)$/.exec(gedruckt.zahlText)![1].replace(/\./g, ''));
  // Die Leiste misst `meter` Gelände auf ihrer gedruckten Länge: daraus folgt die Zahl.
  const meter =
    (gedruckt.leisteText.includes('km') ? 1000 : 1) *
    Number(/[\d,]+/.exec(gedruckt.leisteText)![0].replace(',', '.'));
  const erwartet = meter / (gedruckt.leisteBreitePx / PX_JE_MM / 1000);
  test.info().annotations.push({
    type: 'messwert',
    description: `Bild ${breiteMm.toFixed(1)} × ${(gedruckt.bildHoehePx / PX_JE_MM).toFixed(1)} mm, ${gedruckt.zahlText}, gerechnet 1 : ${Math.round(erwartet)}`,
  });
  expect(gedruckt.bildHoehePx / PX_JE_MM, 'kleiner als die größte Fläche (95 mm)').toBeLessThan(94);
  expect(gedruckt.leisteBreitePx / gedruckt.bildBreitePx).toBeGreaterThan(0.1);
  expect(gedruckt.leisteBreitePx / gedruckt.bildBreitePx).toBeLessThanOrEqual(0.25);
  expect(Math.abs(zahl - erwartet) / erwartet, 'Zahl gehört zur gedruckten Breite').toBeLessThan(
    0.06,
  );

  if (page.context().browser()?.browserType().name() === 'chromium') {
    const seiten = await pdfAuszug(
      await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }),
    );
    test.info().annotations.push({
      type: 'messwert',
      description: seiten.map((s) => `${s.bilder.length} Bilder`).join(' · '),
    });
    expect(seiten, 'der Lageplan ist ein Blatt').toHaveLength(1);
    const [blatt] = seiten;
    expect(blatt.text).toContain('Zone 15');
    expect(blatt.text).toMatch(/Maßstab ca\. 1 : [\d.]+/);
    // Logo und Kartenbild.
    expect(blatt.bilder.length).toBe(2);
  } else {
    test.info().annotations.push({ type: 'nur-chromium', description: 'Seitenzahl im PDF' });
  }
  await page.emulateMedia({ media: null });
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
