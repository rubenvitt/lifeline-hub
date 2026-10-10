import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einsatztagebuch“ (`docs/anwender/kapitel/einsatztagebuch.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatztagebuch`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zeitachse.png       frontend/src/pages/EtbPage.tsx, frontend/src/etb/EtbZeitachse.tsx,
 *                       frontend/src/etb/EtbFilterleiste.tsx, frontend/src/etb/EtbBilanz.tsx
 *   erfassung.png       frontend/src/etb/Schnellerfassung.tsx, frontend/src/etb/MetaChip.tsx,
 *                       frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx
 *   berichtigung.png    frontend/src/etb/Schnellerfassung.tsx (Berichtigung)
 *   wiedervorlage.png   frontend/src/etb/WiedervorlageModal.tsx
 */

const KAPITEL = 'einsatztagebuch';

/** Öffnet das ETB des Demo-Einsatzes und wartet, bis Einträge und Erfassungsleiste stehen. */
async function etbOeffnen(page: Page) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/etb`);
  const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(zeitachse.getByTestId('etb-ereigniszeile').first()).toBeVisible();
  const leiste = page.locator('.etb-erfassung-sticky');
  await expect(leiste.getByPlaceholder('Inhalt …')).toBeVisible();
  return { zeitachse, leiste };
}

/** Nimmt den Fokus aus dem Feld, das die Seite beim Laden fokussiert (kein Fokusring im Bild). */
async function fokusWeg(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe(KAPITEL, () => {
  test('Zeitachse mit Filter, Bilanz und Erfassungsleiste', async ({ page }) => {
    await etbOeffnen(page);
    await expect(page.getByRole('complementary', { name: 'Bilanz des Tagebuchs' })).toBeVisible();
    await fokusWeg(page);
    await fotografiere(page, KAPITEL, 'zeitachse');
  });

  test('Erfassungsleiste mit Text, Von und An', async ({ page }) => {
    const { leiste } = await etbOeffnen(page);
    const feld = leiste.getByPlaceholder('Inhalt …');
    await feld.fill('Florian Musterstadt 2/1: Pumpe am Keller Lindenstraße 4 in Betrieb.');
    await fokusWeg(page);
    await fotografiere(leiste, KAPITEL, 'erfassung');
  });

  test('Berichtigung eines Eintrags', async ({ page }) => {
    const { zeitachse, leiste } = await etbOeffnen(page);
    await zeitachse
      .getByRole('button', { name: /^Aktionen zu Eintrag \d+$/ })
      .first()
      .click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Berichtigen' }).click();
    await expect(leiste.getByText(/^Berichtigung zu Nr\. \d+$/)).toBeVisible();
    await leiste
      .getByPlaceholder('Inhalt …')
      .fill('Richtig: Pumpe am Keller Lindenstraße 6, nicht 4.');
    await fokusWeg(page);
    await fotografiere(leiste, KAPITEL, 'berichtigung');
  });

  test('Dialog „Wiedervorlage anlegen“', async ({ page }) => {
    const { zeitachse } = await etbOeffnen(page);
    await zeitachse
      .getByRole('button', { name: /^Aktionen zu Eintrag \d+$/ })
      .first()
      .click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Wiedervorlage' }).click();
    const dialog = page.getByRole('dialog', { name: 'Wiedervorlage anlegen' });
    await expect(dialog.getByLabel('Titel')).toBeVisible();
    await fokusWeg(page);
    await fotografiere(dialog, KAPITEL, 'wiedervorlage');
  });
});
