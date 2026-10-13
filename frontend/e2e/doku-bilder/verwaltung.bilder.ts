import { anmelden, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Verwaltung“ (`docs/anwender/kapitel/verwaltung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep verwaltung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   anzeige.png           frontend/src/pages/einstellungen/AnzeigeEinstellungen.tsx
 *   einsatz-vorgaben.png  frontend/src/pages/einstellungen/EinsatzDefaults.tsx
 *   module-vorgabe.png    frontend/src/pages/einstellungen/EinsatzDefaults.tsx,
 *                         frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx
 */

const KAPITEL = 'verwaltung';

test.describe(KAPITEL, () => {
  test('Sektion „Anzeige“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/einstellungen/anzeige');
    const formular = page.locator('form');
    await expect(formular.getByLabel('Geocoder-URL')).toBeVisible();
    await fotografiere(formular, KAPITEL, 'anzeige');
  });

  test('Einsatz-Vorgaben „Verhalten & Automatik“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/einstellungen/einsatz');
    const paneel = page.getByRole('region', { name: 'Verhalten & Automatik' });
    await expect(paneel.getByLabel('Präfix Einsatznummer')).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'einsatz-vorgaben');
  });

  test('Module für alle Einsätze', async ({ page }) => {
    await anmelden(page);
    const pfad = '/api/org-modul-einstellungen/lageberichte';
    // Nur für die Aufnahme: eine Org-Vorgabe ausgeblendet, danach zurückgesetzt. Sie gälte sonst
    // für jeden Einsatz des Laufs.
    await fuelle(page, 'put', pfad, { benoetigte_rolle: null, sichtbar: false });
    try {
      await uhrAnhalten(page);
      await page.goto('/admin/einstellungen/einsatz');
      const paneel = page.getByRole('region', { name: 'Module für alle Einsätze' });
      await paneel.getByLabel('Modul filtern').fill('Lage');
      await paneel.getByLabel('Modul filtern').blur();
      await expect(paneel.getByText('Einsatzabschnitte')).toBeHidden();
      await expect(
        paneel.getByRole('switch', { name: 'Sichtbar: Lageberichte' }),
      ).not.toBeChecked();
      await fotografiere(paneel, KAPITEL, 'module-vorgabe');
    } finally {
      await fuelle(page, 'put', pfad, { benoetigte_rolle: null, sichtbar: true });
    }
  });
});
