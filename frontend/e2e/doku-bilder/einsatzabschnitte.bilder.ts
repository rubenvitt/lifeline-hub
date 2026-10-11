import { anmelden, demoEinsatz, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Einsatzabschnitte und Führungsorganisation“
 * (`docs/anwender/kapitel/einsatzabschnitte.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatzabschnitte`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   gliederung.png         frontend/src/pages/EinsatzabschnittePage.tsx,
 *                          frontend/src/pages/einsatzabschnitte/AbschnittDetail.tsx
 *   abschnitt-anlegen.png  frontend/src/pages/einsatzabschnitte/AbschnittAnlegenModal.tsx
 *   organigramm.png        frontend/src/pages/einsatzabschnitte/Organigramm.tsx
 *
 * Daten: Abschnitte, Unterabschnitt und Einheiten stammen aus den Demo-Daten; der neue Abschnitt
 * wird nur ausgefüllt, nicht angelegt.
 */

const KAPITEL = 'einsatzabschnitte';

test.describe(KAPITEL, () => {
  test('Gliederung mit gewähltem Abschnitt', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte`);
    const gliederung = page.getByRole('region', { name: 'Gliederung' });
    await gliederung.getByText('Sanitätsdienst').first().click();
    const detail = page.getByRole('region', { name: 'Abschnitt: Sanitätsdienst' });
    await expect(detail.getByRole('radiogroup', { name: 'Lagezustand' })).toBeVisible();
    await expect(detail.getByText('Zugeordnete Einheiten')).toBeVisible();
    await expect(detail.getByRole('listitem').first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'gliederung');
  });

  test('Dialog „Abschnitt anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte`);
    await expect(page.getByRole('region', { name: 'Gliederung' })).toBeVisible();
    await page.getByRole('button', { name: 'Abschnitt anlegen' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Abschnitt anlegen' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Deichverteidigung');
    await dialog.getByRole('textbox', { name: 'Kurzbezeichnung' }).fill('EA 4');
    await dialog.getByRole('textbox', { name: 'Kurzbezeichnung' }).blur();
    await fotografiere(dialog, KAPITEL, 'abschnitt-anlegen');
  });

  test('Organigramm der Führungsorganisation', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte?ansicht=organigramm`);
    const organigramm = page.locator('.organigramm-print-root');
    await expect(organigramm.getByRole('group', { name: 'Einsatzleitung' })).toBeVisible();
    await expect(organigramm.getByText('UHS Turnhalle').first()).toBeVisible();
    await fotografiere(organigramm, KAPITEL, 'organigramm');
  });
});
