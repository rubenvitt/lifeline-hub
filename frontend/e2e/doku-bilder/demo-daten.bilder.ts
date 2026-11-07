import { anmelden, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Demo-Daten“ (`docs/anwender/kapitel/demo-daten.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep demo-daten`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   stand.png      frontend/src/admin/DemoDatenPage.tsx
 *   entfernen.png  frontend/src/admin/DemoDatenPage.tsx
 *
 * Der Bildlauf hat die Starkregen-Lage schon eingespielt (`vorbereitung.ts`), das Stadtfest nicht:
 * das Bild zeigt so beide Zustände. Die Rückfrage bleibt offen: ein Neu-Import oder Entfernen
 * träfe die Bilder aller anderen Kapitel.
 */

const KAPITEL = 'demo-daten';

test.describe(KAPITEL, () => {
  test('Stand der Demo-Daten', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/demo-daten');
    const starkregen = page.getByRole('region', { name: 'Starkregen' });
    await expect(starkregen.getByRole('button', { name: 'Neu importieren' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Letzter Vorgang Starkregen' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Stadtfest' }).getByRole('button', { name: 'Importieren' }),
    ).toBeVisible();
    await fotografiere(page.locator('[data-lfh="demo-lagen"]'), KAPITEL, 'stand');
  });

  test('Rückfrage „Demo-Lage Starkregen entfernen?“', async ({ page }) => {
    await anmelden(page);
    await uhrAnhalten(page);
    await page.goto('/admin/demo-daten');
    await page
      .getByRole('region', { name: 'Starkregen' })
      .getByRole('button', { name: 'Entfernen' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Demo-Lage Starkregen entfernen?' });
    await expect(dialog.getByRole('button', { name: 'Endgültig entfernen' })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(dialog, KAPITEL, 'entfernen');
  });
});
