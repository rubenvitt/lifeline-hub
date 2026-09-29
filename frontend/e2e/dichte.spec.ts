import { expect, test, type Page } from '@playwright/test';

/**
 * Die Bediendichte im Browser: ob aus einer Steuerhöhe von 72 auch 72 gerenderte Pixel werden
 * (Vitest belegt nur, dass die Stufe am ConfigProvider und am `<html>` ankommt).
 *
 * KEIN Login: `/login` ist öffentlich, und der Theme-Provider hängt über der ganzen App. Die
 * Stufe wird per `addInitScript` gespeichert — der Weg eines wiederkehrenden Benutzers.
 *
 * Dieses Paket belegt den MECHANISMUS am Anmelde-Knopf (`size="large"`); die
 * Trefflächen-Geometrie je Route liegt bei den Modul-Specs, der Tablet-Nachweis in
 * `trefflaeche-tablet.spec.ts` (braucht `hasTouch` und Login).
 */

const SCHLUESSEL = 'lifeline-hub.dichte';

/** Höhe des Anmelde-Knopfs, mit Wiederholung: das Merkmal am `<html>` setzt ein Effekt, und
 *  antd spritzt seine Stilregeln danach noch einmal nach. */
async function knopfhoehe(page: Page): Promise<number> {
  const knopf = page.getByRole('button', { name: 'Anmelden', exact: true });
  await expect(knopf).toBeVisible();
  let gemessen = 0;
  await expect
    .poll(
      async () => {
        gemessen = (await knopf.boundingBox())?.height ?? 0;
        return gemessen;
      },
      { message: 'Höhe des Anmelde-Knopfs' },
    )
    .toBeGreaterThan(0);
  return gemessen;
}

test('gespeicherte Stufe handschuh trägt sich bis in die Trefffläche', async ({ page }) => {
  await page.addInitScript(
    ([schluessel, stufe]) => window.localStorage.setItem(schluessel, stufe),
    [SCHLUESSEL, 'handschuh'] as const,
  );
  await page.goto('/login');

  // Auto-Retry ist Pflicht: das Merkmal setzt ein Effekt, beim ersten Bild fehlt es noch.
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  const hoehe = await knopfhoehe(page);
  // `size="large"` ergibt das 1,25-fache der Steuerhöhe: 72 × 1,25 = 90. Das Fenster liegt um
  // 90, nicht bei „mindestens 72" — ein Knopf, der die Größen-Angabe verliert, landete genau
  // auf 72. ±4 px schließen 72, 60 (komfortabel) und 37,5 (kompakt) aus.
  expect(hoehe, `handschuh: ${hoehe}px`).toBeGreaterThanOrEqual(86);
  expect(hoehe, `handschuh: ${hoehe}px`).toBeLessThanOrEqual(94);
});

test('ohne Seed bleibt es kompakt', async ({ page }) => {
  // Die Gegenprobe: erst sie belegt, dass die STUFE den Knopf groß macht.
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');

  const hoehe = await knopfhoehe(page);
  // 30 × 1,25 = 37,5. Ein Fenster um diesen Wert, damit auch eine falsch angekommene Stufe
  // komfortabel (60 px) auffällt — belegt wird KOMPAKT, nicht bloß „kleiner als handschuh".
  expect(hoehe, `kompakt: ${hoehe}px`).toBeGreaterThanOrEqual(34);
  expect(hoehe, `kompakt: ${hoehe}px`).toBeLessThanOrEqual(42);
});
