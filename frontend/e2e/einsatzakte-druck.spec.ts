import { expect, test, type Page } from '@playwright/test';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Einsatzakte (LLH-1835, Spec `einsatzakte`): sechs Kapitel in einer Druckwurzel, jedes ab neuer
 * Seite mit eigenem Druckkopf. Chromium, Firefox und WebKit prüfen die Mechanik unter Druckmedium
 * (`DRUCK_SPECS`); das PDF (jedes Kapitel beginnt auf eigener Seite, der Name der Betroffenen
 * steht darin) gibt es nur in Chromium. Daneben liefert der ZIP-Link ein ZIP.
 *
 * Mutationsprobe: die Kapitel in ein gemeinsames `div` gelegt (keine Geschwister mehr, die Regel
 * in `druck/druck.css` greift nicht) → `break-before` ist `auto`, rot.
 */

const A4_DRUCKBREITE = 680;
const KAPITEL = [
  'Einsatzbericht',
  'Einsatztagebuch',
  'Betroffene',
  'Aufträge',
  'Einsatzbefehle',
  'Lageberichte',
];

async function seede(page: Page): Promise<number> {
  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Einsatzakte ${Date.now()}` },
  });
  expect(neu.ok(), `Einsatz: ${neu.status()}`).toBeTruthy();
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const person = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
    data: { name: 'Aktenfeld', vorname: 'Agathe' },
  });
  expect(person.ok(), `Person: ${person.status()} ${await person.text()}`).toBeTruthy();
  return einsatzId;
}

/** Druck wie die Person: der Knopf löst `beforeprint` aus (`emulateMedia` feuert es nicht). */
async function drucke(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });
}

test('Einsatzakte: jedes Kapitel auf neuer Seite mit Druckkopf, ZIP abrufbar', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await seede(page);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten/akte`);

  const kapitel = page.locator('[data-lfh="druckwurzel"] [data-lfh="druck-kapitel"]');
  await expect(kapitel).toHaveCount(KAPITEL.length);
  await expect(page.getByRole('button', { name: /Drucken/ })).toBeEnabled();
  for (const [i, titel] of KAPITEL.entries()) {
    await expect(kapitel.nth(i).locator('[data-lfh="druckkopf"] h2')).toHaveText(titel);
  }
  await expect(kapitel.nth(2)).toContainText('Aktenfeld');

  await drucke(page);
  const brueche = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-lfh="druck-kapitel"]')).map(
      (k) => getComputedStyle(k).breakBefore,
    ),
  );
  expect(brueche[0], 'das erste Kapitel beginnt ohne Leerseite').not.toBe('page');
  expect(brueche.slice(1), 'jedes weitere Kapitel beginnt auf neuer Seite').toEqual(
    KAPITEL.slice(1).map(() => 'page'),
  );

  if (browserName === 'chromium') {
    const seiten = await pdfAuszug(await page.pdf({ format: 'A4', preferCSSPageSize: true }));
    test.info().annotations.push({ type: 'messwert', description: `${seiten.length} Seiten` });
    const erste = KAPITEL.map((t) => seiten.findIndex((s) => s.text.includes(t)));
    for (let i = 1; i < erste.length; i++) {
      expect(erste[i], `${KAPITEL[i]} nach ${KAPITEL[i - 1]}`).toBeGreaterThan(erste[i - 1]);
    }
    expect(seiten.some((s) => s.text.includes('Aktenfeld'))).toBe(true);
  } else {
    test.info().annotations.push({ type: 'nur-chromium', description: 'Seiten im PDF' });
  }
  await page.emulateMedia({ media: null });

  const zip = await page.request.get(`/api/einsaetze/${einsatzId}/case-file/attachments.zip`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toBe('application/zip');
  // Lokaler Kopf einer ZIP-Datei: „PK\x03\x04“.
  expect((await zip.body()).subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
});
