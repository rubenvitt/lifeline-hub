import {
  anmelden,
  demoEinsatz,
  einsatzleiterFuellen,
  expect,
  fotografiere,
  fuehrungsstelleOrtFuellen,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Einsatzabschnitte und Führungsorganisation“
 * (`docs/anwender/kapitel/einsatzabschnitte.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatzabschnitte`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   gliederung.png         frontend/src/pages/EinsatzabschnittePage.tsx,
 *                          frontend/src/pages/einsatzabschnitte/AbschnittDetail.tsx,
 *                          frontend/src/pages/einsatzabschnitte/GliederungDrag.tsx (Griffe)
 *   verschieben-unter.png  frontend/src/pages/einsatzabschnitte/VerschiebenDialog.tsx
 *   abschnitt-anlegen.png  frontend/src/pages/einsatzabschnitte/AbschnittAnlegenModal.tsx
 *   organigramm.png        frontend/src/pages/einsatzabschnitte/Organigramm.tsx
 *
 * Daten: Abschnitte, Unterabschnitt und Einheiten stammen aus den Demo-Daten; der neue Abschnitt
 * wird nur ausgefüllt, nicht angelegt, der Dialog „Verschieben unter …“ nur geöffnet.
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
    // Zeiger und Fokus aus der Gliederung: sonst stünde „Live pausiert“ im Bild (Zufluss-Schleuse).
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(gliederung.getByText('Live', { exact: true })).toBeVisible();
    await fotografiere(page, KAPITEL, 'gliederung');
  });

  test('Dialog „Verschieben unter …“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte`);
    const gliederung = page.getByRole('region', { name: 'Gliederung' });
    await gliederung.getByText('Sanitätsdienst').first().click();
    await page
      .getByRole('button', { name: 'Weitere Aktionen zu Abschnitt Sanitätsdienst' })
      .click();
    await page.getByRole('menuitem', { name: 'Verschieben unter …' }).click();
    const dialog = page.getByRole('dialog', { name: '„Sanitätsdienst“ verschieben unter …' });
    await expect(dialog.getByRole('button', { name: 'Oberste Ebene' })).toBeVisible();
    await fotografiere(dialog, KAPITEL, 'verschieben-unter');
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
    // Die Wurzel nennt die eigene Führungsstelle (LFH-1181) und den Einsatzleiter (LFH-1199).
    await fuehrungsstelleOrtFuellen(page, demo.id);
    await einsatzleiterFuellen(page.request, demo);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzabschnitte?ansicht=organigramm`);
    const organigramm = page.locator('.organigramm-print-root');
    const wurzel = organigramm.getByRole('group', { name: 'Einsatzleitung' });
    await expect(wurzel.getByText('ELW 2 Musterstadt')).toBeVisible();
    await expect(wurzel).toContainText('Max Mustermann');
    await expect(organigramm.getByText('UHS Turnhalle').first()).toBeVisible();
    await fotografiere(organigramm, KAPITEL, 'organigramm');
  });
});
