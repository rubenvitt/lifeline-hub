import { expect, test, type Page } from '@playwright/test';
import { einsatzMitLage, grundlageOhneNetz, lagekarteBereit } from './lageplan-kern';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Lagekarte als Lageplan drucken (LLH-1051, Spec `lagekarte-druck`), was nur der Browser zeigt:
 * das Bild kommt aus der WebGL-Leinwand (ohne `preserveDrawingBuffer`), das Blatt steht A4 quer
 * mit Druckkopf, Maßstab, Nordpfeil und Legende, und eine gesperrte Ebene fehlt auf beidem.
 * Chromium, Firefox und WebKit prüfen Aufnahme und Mechanik unter Druckmedium (`DRUCK_SPECS`);
 * das PDF (Seitenformat, ein Blatt) gibt es nur in Chromium.
 *
 * Mutationsproben: `page: lageplan` in `lageplanDruck.css` weg → das Blatt ist A4 hoch, rot;
 * Aufnahme ohne `once('render')` (direkt `toBlob`) → leere Leinwand, das Bild ist einfarbig, rot;
 * Legende aus den Schaltern statt aus dem Gezeichneten → „Abschnitte“ steht da, rot.
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
  await anmeldenAls(page, ADMIN, ADMIN_PW);
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
  await anmeldenAls(page, ADMIN, ADMIN_PW);
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
