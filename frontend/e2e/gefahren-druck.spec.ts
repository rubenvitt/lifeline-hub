import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Druck der Gefahrenseite (LLH-1364, Spec `gefahrenmatrix`, „Die Gefahrenseite druckt das gewählte
 * Gebiet“): was nur der Browser zeigt. Chromium, Firefox und WebKit prüfen unter Druckmedium mit
 * ausgelöstem `beforeprint` (`DRUCK_SPECS`, `frontend/src/druck/AGENTS.md`):
 *
 * - die Druckwurzel steht im Fluss und oben, Gebietsliste und Bedienung belegen keinen Platz;
 * - die Matrix steht ohne stehende Kopfzeile ganz im Blatt (A4-Breite);
 * - die Marke „mit Erläuterung“ ist schwarz und hat Fläche — sie ist ein Rand, kein Hintergrund,
 *   und steht deshalb auch schwarz-weiß und ohne „Hintergründe drucken“;
 * - „nicht anwendbar“ druckt seine Schraffur;
 * - die Liste „Erläuterungen“ steht in der Folge der Matrix, ohne Erläuterung fehlt sie.
 *
 * Das PDF (Text des Blatts) gibt es nur in Chromium.
 *
 * Mutationsprobe: in `gefahrenPrint.css` die Regel `.gefahren-no-print` streichen → die
 * Gebietsliste steht unter Druckmedium, rot in allen drei Engines.
 */

test.setTimeout(120_000);

const SCHWARZ = 'rgb(0, 0, 0)';
/** A4 hoch, nutzbare Breite in CSS-Pixeln (wie `meldebild-druck.spec.ts`). */
const A4_DRUCKBREITE = 680;
const SUBPIXEL = 0.5;

/** Ein Gefahrengebiet über die API; liefert seine id. */
async function gebietAnlegen(page: Page, einsatzId: string, label: string): Promise<number> {
  const zone = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
    data: {
      typ: 'gefahrengebiet',
      geometrie_typ: 'Polygon',
      geometrie: JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [10.0, 50.0],
            [10.01, 50.0],
            [10.01, 50.01],
            [10.0, 50.01],
            [10.0, 50.0],
          ],
        ],
      }),
      label,
    },
  });
  expect(zone.ok(), `Zone: ${zone.status()} ${await zone.text()}`).toBe(true);
  const gebiete = await page.request.get(`/api/einsaetze/${einsatzId}/gefahrengebiete`);
  const liste = (await gebiete.json()) as { id: number; label: string | null }[];
  return liste.find((g) => g.label === label)!.id;
}

async function bewerten(
  page: Page,
  einsatzId: string,
  gebietId: number,
  daten: Record<string, string | null>,
) {
  const r = await page.request.put(
    `/api/einsaetze/${einsatzId}/gefahrengebiete/${gebietId}/matrix/bewertung`,
    { data: { beschreibung: null, gemeldet_von: null, ...daten } },
  );
  expect(r.ok(), `Bewertung: ${r.status()} ${await r.text()}`).toBe(true);
}

/** Drucken über den Nebenweg, mit ausgelöstem `beforeprint` statt Dialog, dann Druckmedium. */
async function druckenUnterDruckmedium(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  // Auf A4-Breite (unter `md`) steht der Nebenweg hinter „Weitere“ (LFH-963).
  await page.getByRole('button', { name: 'Weitere Aktionen zu den Gefahren' }).click();
  await page.getByRole('menuitem', { name: 'Drucken / als PDF' }).click();
  await page.emulateMedia({ media: 'print' });
}

test('das Blatt trägt Matrix, schwarze Marke und die Erläuterungen in der Folge der Matrix', async ({
  page,
  browserName,
}) => {
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Gefahren-Druck ${Date.now()}`);
  const gebiet = await gebietAnlegen(page, einsatzId, 'Überflutung Unterstadt');
  // Absichtlich nicht in Matrixfolge angelegt: die Liste ordnet selbst.
  await bewerten(page, einsatzId, gebiet, {
    gefahrentyp: 'elektrizitaet',
    schutzobjekt: 'einsatzkraefte',
    warnstufe: 'mittel',
    beschreibung: 'Pumpen nur mit FI-Schutz betreiben.',
  });
  await bewerten(page, einsatzId, gebiet, {
    gefahrentyp: 'elektrizitaet',
    schutzobjekt: 'menschen',
    warnstufe: 'hoch',
    beschreibung: 'Stromführende Kellerverteilungen unter Wasser.',
    gemeldet_von: 'Rettungsstaffel',
  });
  await bewerten(page, einsatzId, gebiet, {
    gefahrentyp: 'ertrinken',
    schutzobjekt: 'menschen',
    warnstufe: 'mittel',
  });
  await bewerten(page, einsatzId, gebiet, {
    gefahrentyp: 'brand',
    schutzobjekt: 'sachwerte',
    warnstufe: 'keine',
    beschreibung: 'Geprüft, kein Brand im Lager.',
  });

  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  const liste = wurzel.locator('[data-lfh="gefahren-erlaeuterungen"]');
  await expect(liste).toContainText('Elektrizität × Menschen');
  // Vorbedingung am Schirm: Gebietsliste da, Druckkopf nicht.
  await expect(page.getByRole('region', { name: 'Gefahrengebiete' })).toBeVisible();
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toBeHidden();

  await druckenUnterDruckmedium(page);
  await expect(wurzel).toBeVisible();
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toBeVisible();
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toContainText(
    'Gefahrenbewertung – Überflutung Unterstadt',
  );
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toContainText('nicht beurteilt');

  const blatt = await page.evaluate(() => {
    const w = document.querySelector('[data-lfh="druckwurzel"]')!;
    const r = w.getBoundingClientRect();
    const anzeige = (el: Element | null) => (el ? getComputedStyle(el).display : 'fehlt');
    const zellen = Array.from(
      document.querySelector('.gefahren-matrix tr.ant-table-row')!.querySelectorAll(':scope > td'),
    ) as HTMLElement[];
    const marken = Array.from(
      document.querySelectorAll('.gefahren-matrix [data-lfh="erlaeuterung-marke"]'),
    );
    const nichtAnwendbar = document.querySelector('.gefahren-matrix [data-lfh="nicht-anwendbar"]')!;
    return {
      wurzelOben: r.top,
      wurzelRechts: r.right,
      letzteRechts: zellen[zellen.length - 1].getBoundingClientRect().right,
      ohneDruck: Array.from(document.querySelectorAll('.gefahren-no-print')).map(anzeige),
      seitenkopf: anzeige(document.querySelector('[data-lfh="seitenkopf"]')),
      halter: document.querySelectorAll('.gefahren-matrix .ant-table-sticky-holder').length,
      marken: marken.map((m) => {
        const s = getComputedStyle(m);
        return {
          farbe: s.borderTopColor,
          breite: parseFloat(s.borderTopWidth),
          display: s.display,
        };
      }),
      schraffur: getComputedStyle(nichtAnwendbar).backgroundImage,
      titel: Array.from(
        document.querySelectorAll('[data-lfh="gefahren-erlaeuterungen"] .listen-eintrag strong'),
      ).map((t) => t.textContent),
    };
  });
  expect(blatt.wurzelOben, 'Druckwurzel steht oben').toBeLessThanOrEqual(1);
  expect(blatt.seitenkopf, 'Seitenkopf belegt keinen Platz').toBe('none');
  expect(blatt.ohneDruck.length, 'Vorbedingung: es gibt Bildschirmteile').toBeGreaterThan(0);
  expect(new Set(blatt.ohneDruck), 'Gebietsliste und Bedienung belegen keinen Platz').toEqual(
    new Set(['none']),
  );
  expect(blatt.halter, 'im Druck ohne stehende Kopfzeile').toBe(0);
  expect(blatt.letzteRechts, 'die Matrix steht ganz im Blatt').toBeLessThanOrEqual(
    blatt.wurzelRechts + SUBPIXEL,
  );
  // Drei Zellen mit Erläuterung, jede Marke schwarz und mit Fläche.
  expect(blatt.marken).toHaveLength(3);
  for (const m of blatt.marken) {
    expect(m.farbe).toBe(SCHWARZ);
    expect(m.breite).toBeGreaterThan(0);
    expect(m.display).not.toBe('none');
  }
  expect(blatt.schraffur).toContain('repeating-linear-gradient');
  expect(blatt.titel).toEqual([
    'Brand × Sachwerte',
    'Elektrizität × Menschen',
    'Elektrizität × Einsatzkräfte',
  ]);
  await expect(liste).toContainText('gemeldet von Rettungsstaffel');
  await expect(liste).toContainText('Geprüft, kein Brand im Lager.');

  if (browserName === 'chromium') {
    test.info().annotations.push({ type: 'nur-chromium', description: 'PDF des Blatts' });
    const seiten = await pdfAuszug(await page.pdf({ format: 'A4' }));
    const text = seiten.map((s) => s.text).join(' ');
    expect(text).toContain('Gefahrenbewertung');
    expect(text).toContain('Erläuterungen');
    expect(text).toContain('Stromführende Kellerverteilungen unter Wasser.');
    expect(text).not.toContain('Umbenennen');
  }
  await page.emulateMedia({ media: null });
});

test('ohne Erläuterung fehlt der Teil auch auf dem Blatt', async ({ page }) => {
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Gefahren-Druck leer ${Date.now()}`);
  const gebiet = await gebietAnlegen(page, einsatzId, 'Hangrutsch Kirchberg');
  await bewerten(page, einsatzId, gebiet, {
    gefahrentyp: 'einsturz',
    schutzobjekt: 'menschen',
    warnstufe: 'hoch',
  });
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  await expect(
    wurzel.getByRole('button', { name: 'Bewertung Einsturz × Menschen: hoch' }),
  ).toBeVisible();

  await druckenUnterDruckmedium(page);
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toContainText(
    'Gefahrenbewertung – Hangrutsch Kirchberg',
  );
  await expect(wurzel.locator('.gefahren-matrix')).toBeVisible();
  await expect(wurzel.locator('[data-lfh="gefahren-erlaeuterungen"]')).toHaveCount(0);
  // Keine Zelle trägt die Marke (die Legende nennt sie trotzdem).
  await expect(wurzel.locator('.gefahren-matrix [data-lfh="erlaeuterung-marke"]')).toHaveCount(0);
  await page.emulateMedia({ media: null });
});
