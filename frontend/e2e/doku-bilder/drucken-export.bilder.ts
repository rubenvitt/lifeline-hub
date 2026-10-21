import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';
import { oeffneKarte } from './lagekarte-kern';

/**
 * Bilder des Kapitels „Drucken und Export“ (`docs/anwender/kapitel/drucken-export.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep drucken-export`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   etb-druckansicht.png   frontend/src/pages/EtbDruckPage.tsx, frontend/src/etb/EtbDruckTabelle.tsx
 *   listen-druckansicht.png  frontend/src/druck/ListenDruckSeite.tsx, frontend/src/pages/PersonenDruckPage.tsx,
 *                          frontend/src/components/druck/Druckkopf.tsx
 *   lageplan-druckblatt.png  frontend/src/pages/lagekarte/LageplanDruck.tsx,
 *                          frontend/src/pages/lagekarte/lageplanDruck.css,
 *                          frontend/src/pages/lagekarte/useLageplan.ts (Lage aus `lagekarte-kern.ts`)
 */

const KAPITEL = 'drucken-export';

/** Satzspiegel A4 quer (297 mm − 2 × 15 mm Rand, `druck/druck.css`) in CSS-Pixeln. */
const LAGEPLAN_SATZBREITE_PX = Math.round((267 * 96) / 25.4);

/** Öffnet eine Druckansicht und wartet, bis Druckkopf, Tabelle und Druckknopf stehen. */
async function druckansichtOeffnen(page: Page, modul: 'etb' | 'personen') {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/${modul}/druck`);
  await expect(page.locator('[data-lfh="druckkopf"]')).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled();
}

test.describe(KAPITEL, () => {
  test('Druckansicht des Einsatztagebuchs', async ({ page }) => {
    await druckansichtOeffnen(page, 'etb');
    await fotografiere(page, KAPITEL, 'etb-druckansicht');
  });

  test('Druckansicht der Betroffenenliste mit Protokollhinweis', async ({ page }) => {
    await druckansichtOeffnen(page, 'personen');
    await expect(page.getByText('Zugriff wird protokolliert.')).toBeVisible();
    await fotografiere(page, KAPITEL, 'listen-druckansicht');
  });

  test('Lageplan drucken: das Blatt mit Kopf, Karte, Maßstab und Legende', async ({ page }) => {
    await oeffneKarte(page);
    await expect(page.getByRole('group', { name: 'Kartensteuerung' })).toBeVisible();
    // Der Druckweg wie bei der Person, nur ohne Druckdialog: der Knopf nimmt die Karte auf und
    // hängt das Blatt ein, `beforeprint` vermisst es (wie `e2e/lagekarte-druck.spec.ts`). Am
    // Bildschirm ist das Blatt ausgeblendet, es steht nur unter Druckmedium.
    await page.evaluate(() => {
      window.print = () => window.dispatchEvent(new Event('beforeprint'));
    });
    await page.getByRole('button', { name: 'Drucken / als PDF', exact: true }).click();
    const blatt = page.locator('[data-lfh="druckwurzel"] .lageplan-blatt');
    await expect(blatt).toHaveCount(1);
    await page.emulateMedia({ media: 'print' });
    // So breit wie auf Papier: Legendenspalten und Bild stehen wie gedruckt.
    await page.setViewportSize({ width: LAGEPLAN_SATZBREITE_PX, height: 900 });
    await expect(blatt.locator('[data-lfh="druckkopf"]')).toContainText('Lageplan');
    await expect(blatt.locator('[data-lfh="lageplan-legende"]')).toBeVisible();
    await expect(blatt.locator('[data-lfh="lageplan-verhaeltnis"]')).toHaveText(
      /^Maßstab ca\. 1 : /,
    );
    await blatt
      .locator('[data-lfh="lageplan-bild"]')
      .evaluate((img: HTMLImageElement) => img.decode());
    await fotografiere(blatt, KAPITEL, 'lageplan-druckblatt');
  });
});
