import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einsatztagebuch“ (`docs/anwender/kapitel/einsatztagebuch.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatztagebuch`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zeitachse.png       frontend/src/pages/EtbPage.tsx, frontend/src/etb/EtbZeitachse.tsx,
 *                       frontend/src/components/useFunkprotokollLauf.ts, frontend/src/etb/EtbFilterleiste.tsx,
 *                       frontend/src/etb/EtbSendestatus.tsx
 *   erfassung.png       frontend/src/etb/Schnellerfassung.tsx, frontend/src/etb/EtbFeldzeile.tsx,
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
  test('Zeitachse beim Öffnen am Ende, Filterleiste und Erfassungsleiste', async ({ page }) => {
    await etbOeffnen(page);
    // Die Zahlen je Typ stehen an den Segmenten der Filterleiste (kwc2yszv D7, statt der Bilanz).
    await expect(
      page.locator('[data-lfh="etb-filterleiste"] [data-lfh="segment-zahl"]').first(),
    ).toBeVisible();
    await fokusWeg(page);
    await fotografiere(page, KAPITEL, 'zeitachse');
  });

  test('Erfassungsleiste mit Feldzeile, Text und Fußzeile', async ({ page }) => {
    const { leiste } = await etbOeffnen(page);
    // Eine Meldung von außen: Von von Hand, An trägt die eigene Stelle (kwc2yszv D3).
    const von = leiste.getByRole('combobox', { name: 'Von', exact: true });
    await von.fill('Florian Musterstadt 2/1');
    await von.press('Enter');
    const feld = leiste.getByPlaceholder('Inhalt …');
    await feld.fill('Pumpe am Keller Lindenstraße 4 in Betrieb.');
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
