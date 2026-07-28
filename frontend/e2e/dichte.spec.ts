import { expect, test, type Page } from '@playwright/test';

/**
 * Die Bediendichte im Browser (LFH-329 · B1).
 *
 * WARUM HIER UND NICHT IN VITEST: die Vitest-Suite belegt, dass die Stufe am
 * ConfigProvider und am `<html>` ankommt — aber jsdom rechnet kein Layout, und
 * `vite.config.ts` fährt Vitest mit `css: false`. Ob aus einer Steuerhöhe von
 * 72 auch 72 gerenderte Pixel werden, ist ausschließlich hier messbar.
 *
 * KEIN Login: `/login` ist öffentlich, und der Theme-Provider hängt in `main.tsx`
 * über der ganzen App. Die gespeicherte Stufe wird per `addInitScript` gesetzt —
 * damit prüft der Test denselben Weg, den ein wiederkehrender Benutzer nimmt.
 *
 * ABGRENZUNG: die vollständige Trefflächen-Geometrie (jedes fokussierbare Element
 * je umgebauter Route) bleibt bei den Modulpaketen. Dieses Paket liefert den
 * MECHANISMUS und belegt nur, dass er bis in die Pixel durchschlägt. Die
 * Anmeldeseite trägt dafür bewusst keine Änderung; ihre punktuellen
 * Größen-Angaben sind Bestand und fallen in ihrem eigenen Paket.
 *
 * Bewusst KEIN zweites Playwright-Projekt und kein Device-Descriptor: das zöge
 * einen Browser-Download nach sich, für den es im Repo keinen Guard gibt.
 */

const SCHLUESSEL = 'lifeline-hub.dichte';

/** Höhe des Anmelde-Knopfs, mit Wiederholung.
 *
 *  Zwei Beats liegen zwischen dem ersten Bild und dem Endmaß: das Merkmal am
 *  `<html>` wird in einem Effekt gesetzt, und antd spritzt seine Stilregeln
 *  danach noch einmal nach. Eine einmalige Messung wäre deshalb flaky. */
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

  // Auto-Retry ist hier Pflicht: das Merkmal setzt ein Effekt, beim ersten Bild
  // fehlt es noch.
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  const hoehe = await knopfhoehe(page);
  // Der Knopf trägt eine große Größen-Angabe, antd leitet daraus das 1,25-fache
  // der Steuerhöhe ab: 72 × 1,25 = 90. Zweiseitig gepinnt, damit nicht irgendein
  // anderer Grund die Schwelle reißt — eine bloße Untergrenze wäre auch von einem
  // umgebrochenen Knopf erfüllt.
  expect(hoehe, `handschuh: ${hoehe}px`).toBeGreaterThanOrEqual(72);
  expect(hoehe, `handschuh: ${hoehe}px`).toBeLessThan(96);
});

test('ohne Seed bleibt es kompakt', async ({ page }) => {
  // Die Gegenprobe. Ohne sie belegte der Test oben nur, dass irgendetwas groß
  // ist — nicht, dass die STUFE es groß macht.
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');

  const hoehe = await knopfhoehe(page);
  // 30 × 1,25 = 37,5.
  expect(hoehe, `kompakt: ${hoehe}px`).toBeLessThan(72);
  expect(hoehe, `kompakt: ${hoehe}px`).toBeGreaterThan(24);
});
