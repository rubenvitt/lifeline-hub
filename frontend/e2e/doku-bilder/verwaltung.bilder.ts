import { anmelden, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Verwaltung“ (`docs/anwender/kapitel/verwaltung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep verwaltung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   anzeige.png           frontend/src/pages/einstellungen/AnzeigeEinstellungen.tsx
 *   einsatz-vorgaben.png  frontend/src/pages/einstellungen/EinsatzDefaults.tsx
 *   rollen-vorgabe.png    frontend/src/pages/einstellungen/EinsatzDefaults.tsx,
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

  test('Rollen-Vorgabe je Modul', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/einstellungen/einsatz');
    const paneel = page.getByRole('region', { name: 'Rollen-Vorgabe je Modul' });
    await paneel.getByLabel('Modul filtern').fill('Lage');
    await paneel.getByLabel('Modul filtern').blur();
    await expect(paneel.getByText('Einsatzabschnitte')).toBeHidden();
    await fotografiere(paneel, KAPITEL, 'rollen-vorgabe');
  });
});
