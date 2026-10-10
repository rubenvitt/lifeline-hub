import { waehleIn } from '../auswahl-kern';
import { anmelden, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Karten“ (`docs/anwender/kapitel/karten.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep karten`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   online-quelle.png   frontend/src/karten/OnlineQuelleFormModal.tsx
 *   katalog.png         frontend/src/karten/AusKatalogModal.tsx
 *   offline-karten.png  frontend/src/karten/OfflineKartenVerwaltung.tsx,
 *                       frontend/src/karten/AutoAktualisierungZeile.tsx
 *
 * Nichts wird gespeichert: eine neue aktive Quelle stünde sonst in der Kartenwahl der Lagekarte
 * anderer Kapitel.
 */

const KAPITEL = 'karten';

test.describe(KAPITEL, () => {
  test('Dialog „Online-Quelle hinzufügen“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/karten/online');
    await page.getByRole('button', { name: 'Quelle hinzufügen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Online-Quelle hinzufügen' });
    await dialog.getByLabel('Name').fill('Basiskarte Land');
    await waehleIn(dialog.getByRole('combobox', { name: 'Typ' }), 'Raster (XYZ-Kacheln)');
    await dialog.getByLabel('URL').fill('https://kacheln.example.org/{z}/{x}/{y}.png');
    await dialog.getByLabel('Attribution').fill('© Landesamt für Vermessung');
    await dialog.getByText('Weitere Angaben').click();
    await expect(dialog.getByLabel('Über Server proxen')).toBeVisible();
    await dialog.getByLabel('Attribution').blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'online-quelle');
  });

  test('Dialog „Aus Katalog hinzufügen“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/karten/online');
    await page.getByRole('button', { name: 'Aus Katalog hinzufügen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Aus Katalog hinzufügen' });
    await expect(dialog.getByRole('button', { name: 'Hinzufügen' }).first()).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'katalog');
  });

  test('Offline-Karten mit automatischer Aktualisierung', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/karten/offline');
    await expect(page.getByText('Automatisch aktualisieren')).toBeVisible();
    // Werkzeugleiste, Zeile „Automatisch aktualisieren“ und Tabelle: der Inhalt der Sektion
    // ohne Warnleiste und Navigation. Die Demo-Daten tragen keine Offline-Karte.
    const inhalt = page
      .getByRole('button', { name: 'Region aufs Gerät bringen' })
      .locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " ant-space ")][1]/..');
    await expect(inhalt.getByText('Noch keine Offline-Karten')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(inhalt, KAPITEL, 'offline-karten');
  });
});
