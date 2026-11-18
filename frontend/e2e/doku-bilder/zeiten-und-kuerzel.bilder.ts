import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Zeiten und Kürzel“ (`docs/anwender/kapitel/zeiten-und-kuerzel.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep zeiten-und-kuerzel`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   staerke.png  frontend/src/kraefte/Verdichtungszeile.tsx (in pages/EinheitenPage.tsx),
 *                frontend/src/anzeige/staerke.ts
 */

const KAPITEL = 'zeiten-und-kuerzel';

test.describe(KAPITEL, () => {
  test('Stärke mit Schreibweise', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    const demo = await demoEinsatz(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten`);
    const zeile = page.locator('[data-lfh="verdichtungszeile"]');
    await expect(zeile).toContainText('Stärke F/UF/M//Σ');
    await expect(zeile.locator('strong')).toHaveText(/^\d+\/\d+\/\d+\/\/\d+$/);
    await fotografiere(zeile, KAPITEL, 'staerke');
  });
});
