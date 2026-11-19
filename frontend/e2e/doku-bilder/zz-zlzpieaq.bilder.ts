import { stehendeAuswahl } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/** Wegwerf-Spec: Vorher/Nachher-Bilder für den PR zu LLH-1818. Wird nach dem PR wieder entfernt. */
const KAPITEL = 'rechte-im-einsatz';
const V = process.env.PR_VARIANTE ?? 'nachher';

test.describe('zz-zlzpieaq', () => {
  test('Zugriff: Rollenauswahl offen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.setViewportSize({ width: 1100, height: 560 });
    await page.goto(`/einsaetze/${demo.id}/einstellungen/zugriff`);
    const zugriff = page.getByRole('region', { name: 'Zugriff' });
    await zugriff.getByRole('combobox').nth(1).click();
    await stehendeAuswahl(page);
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, `zz-${V}-zugriff`);
  });

  test('Benutzerdialog: Rolle in der Organisation offen', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto('/admin/benutzer');
    await page.getByRole('button', { name: 'Benutzer anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neuen Benutzer anlegen' });
    await dialog.getByText('Weitere Angaben').click();
    const feld = dialog.getByLabel(/^(Org-Rolle|Rolle in der Organisation)$/);
    await expect(feld).toBeVisible();
    await feld.click();
    await stehendeAuswahl(page);
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, `zz-${V}-benutzer`);
  });

  test('Module: Stufe offen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const pfad = `/api/einsaetze/${demo.id}/modul-overrides/lagemeldungen`;
    await fuelle(page, 'put', pfad, { sichtbar: null, benoetigte_rolle: 'einsatzfuehrung' });
    try {
      await uhrAnhalten(page);
      await page.setViewportSize({ width: 1100, height: 700 });
      await page.goto(`/einsaetze/${demo.id}/einstellungen/module`);
      const paneel = page.getByRole('region', { name: 'Modul-Sichtbarkeit & Berechtigungen' });
      await paneel.getByLabel('Modul filtern').fill('Lagemeld');
      await paneel.getByLabel('Modul filtern').blur();
      await paneel.getByRole('combobox', { name: 'Benötigte Rolle: Lagemeldungen' }).click();
      await stehendeAuswahl(page);
      await page.mouse.move(0, 0);
      await fotografiere(page, KAPITEL, `zz-${V}-module`);
    } finally {
      await fuelle(page, 'put', pfad, { sichtbar: null, benoetigte_rolle: null });
    }
  });
});
