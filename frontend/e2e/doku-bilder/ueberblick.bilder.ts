import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Überblick“ (`docs/anwender/kapitel/ueberblick.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep ueberblick`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   ueberblick.png   frontend/src/pages/fuehrung/UeberblickPage.tsx
 */

const KAPITEL = 'ueberblick';

/**
 * Der Testbrowser meldet Benachrichtigungen als gesperrt, auch mit `permissions`; die Kopfleiste
 * zeigte dann „Benachrichtigung blockiert“, ein Zustand des Testgeräts, nicht des Einsatzes. Für
 * ganze Seiten gilt deshalb die Erlaubnis wie an einem eingerichteten Gerät.
 */
async function benachrichtigungErlaubt(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
  });
}

test.describe(KAPITEL, () => {
  test('Überblick des Demo-Einsatzes', async ({ page }) => {
    await benachrichtigungErlaubt(page);
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await expect(page.locator('[data-lfh="ueberblick-abschnitt"]').first()).toBeVisible();
    await expect(page.locator('[data-lfh="ueberblick-marke"]').first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'ueberblick');
    // Ablauf weiter: aus dem Paneel der Entscheidungen ins Einsatztagebuch.
    await page.getByRole('link', { name: 'Entscheidungen im Einsatztagebuch öffnen' }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/etb\\?.*typ=entscheidung`));
  });

  test('Vom Überblick zur Erfassung und zum Lagebericht', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await page.getByRole('button', { name: 'Eintrag', exact: true }).click();
    // Die ETB-Seite räumt `neu=1` nach dem Öffnen der Erfassung wieder aus der Adresse.
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/etb`));
    await page.goto(`/einsaetze/${demo.id}/ueberblick`);
    await page.getByRole('button', { name: 'Lagebericht', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/lageberichte$`));
  });
});
