import { expect, test, type Page } from '@playwright/test';
import { einsatzDialogOeffnen } from './einsatz-kern';

/**
 * Die Zelle der Gefahrenmatrix ist EIN Auslöser (Dropdown), kein 5-Wege-Segmentcontrol — das
 * Breitenbudget im Fükw trägt keins. Gemessen: auf dem Führungs-Tablet (komfortabel) ist jede
 * bedienbare Zelle ≥ 44 px hoch. Im Fükw (kompakt) sind 30 px die Staffel, kein Mangel.
 *
 * Seit LLH-1102 füllt der Auslöser die ganze Zelle: ein Tipp in ihre Ecke öffnet das Menü, und
 * im Fükw stehen alle 13 Zeilen ohne Bildlauf.
 */
test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

const DICHTE = 'lifeline-hub.dichte';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Subpixel-Toleranz: Chromium rechnet unter Last anders. */
const SUBPIXEL = 0.5;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

test('jede Matrix-Zelle misst auf dem Tablet mindestens 44 px', async ({ page }) => {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    DICHTE,
    'komfortabel',
  ] as const);
  await anmelden(page);
  await einsatzDialogOeffnen(page);
  await page.getByLabel('Bezeichnung').fill('C12 Matrix');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];

  // Gefahrengebiet über die API. `geometrie` ist ein GeoJSON-STRING, dessen `type` zu
  // `geometrie_typ` passen muss ('Polygon', großgeschrieben).
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
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
      label: 'C12 Gebiet',
    },
  });
  expect(antwort.ok(), `Zone anlegen: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();

  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  // Die Seite wählt das erste Gefahrengebiet automatisch, die Matrix erscheint direkt.
  const zellen = page.getByRole('button', { name: /^Bewertung / });
  await expect(zellen.first()).toBeVisible();
  const n = await zellen.count();
  // 13 Gefahrentypen × 5 Schutzobjekte = 65, davon 58 bedienbar; der Rest ist schraffiert
  // („nicht anwendbar“) ohne Knopf.
  expect(n).toBeGreaterThanOrEqual(58);
  for (let i = 0; i < n; i += 1) {
    const zelle = zellen.nth(i);
    const name = (await zelle.getAttribute('aria-label')) ?? `Zelle ${i}`;
    // `expect.poll`: die Dichte-Staffel greift erst nach dem Mount von
    // `ConfigProvider`/`ThemeModeProvider` — sonst mäße man vor dem endgültigen Layout.
    await expect
      .poll(async () => (await zelle.boundingBox())?.height ?? 0, {
        message: `${name}: Soll ≥ 44 px hoch`,
      })
      .toBeGreaterThanOrEqual(44 - SUBPIXEL);
  }
});

/** Einsatz mit einem Gefahrengebiet über die API (die Oberfläche prüft hier nur die Matrix). */
async function matrixEinsatz(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E 1102 Zelle ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id } = (await antwort.json()) as { id: number };
  const zone = await page.request.post(`/api/einsaetze/${id}/zonen`, {
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
      label: 'Sektor Ecke',
    },
  });
  expect(zone.ok(), await zone.text()).toBeTruthy();
  return id;
}

/** Abstand des Tipps von der Zellkante: innen, aber weit weg vom mittigen Kürzel. */
const ECKE = 3;

test('ein Tipp in die Ecke einer Zelle öffnet das Stufenmenü (LLH-1102)', async ({ page }) => {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    DICHTE,
    'handschuh',
  ] as const);
  await anmelden(page);
  const einsatzId = await matrixEinsatz(page);
  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  const knopf = page.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' });
  await expect(knopf).toBeEnabled();
  await knopf.scrollIntoViewIfNeeded();
  const zelle = (await page.locator('td', { has: knopf }).boundingBox())!;
  const kuerzel = (await knopf.locator('span').first().boundingBox())!;
  // Vorbedingung: die Ecke liegt außerhalb des Kürzels — sonst bewiese der Tipp nichts Neues.
  expect(zelle.x + ECKE, 'die Ecke liegt links vom Kürzel').toBeLessThan(kuerzel.x);
  expect(zelle.y + ECKE, 'die Ecke liegt über dem Kürzel').toBeLessThan(kuerzel.y);
  await page.touchscreen.tap(zelle.x + ECKE, zelle.y + ECKE);
  await expect(page.getByRole('menuitem', { name: 'H · Hoch' })).toBeVisible();
  // Gegenecke: unten rechts trifft dieselbe Zelle.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'H · Hoch' })).toBeHidden();
  await page.touchscreen.tap(zelle.x + zelle.width - ECKE - 1, zelle.y + zelle.height - ECKE - 1);
  await expect(page.getByRole('menuitem', { name: 'H · Hoch' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'H · Hoch' }).click();
  await expect(
    page.getByRole('button', { name: 'Bewertung Brand × Menschen: hoch' }),
  ).toBeVisible();
});

test('im Fükw (1440 × 900, kompakt) stehen alle 13 Zeilen ohne Bildlauf (LLH-1102)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    DICHTE,
    'kompakt',
  ] as const);
  await anmelden(page);
  const einsatzId = await matrixEinsatz(page);
  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
  await expect(page.getByRole('button', { name: /^Bewertung / })).toHaveCount(58);
  expect(await page.evaluate(() => window.scrollY), 'die Seite ist nicht gerollt').toBe(0);
  const zeilen = page.locator('.gefahren-matrix .ant-table-tbody tr.ant-table-row');
  await expect(zeilen).toHaveCount(13);
  // Alphabetisch: die erste und die letzte Zeile.
  await expect(zeilen.first().locator('td').first()).toHaveText('Absturz');
  await expect(zeilen.last().locator('td').first()).toHaveText('Explosion');
  for (let i = 0; i < 13; i += 1) {
    await expect(zeilen.nth(i), `Zeile ${i + 1} ganz im Fenster`).toBeInViewport({ ratio: 1 });
  }
});
