import { expect, test } from '@playwright/test';
import { eingeblendet } from './dialog-kern';
import { anmeldenPerApi } from './anmelde-kern';
import { einsatzPerApi } from './einsatz-kern';

/**
 * LLH-1755: ein Tap neben den Dialog ist im echten Browser kein Abbruch, und Escape mit
 * geänderten Feldern fragt erst nach. Die Logik der Rückfrage prüft Vitest
 * (`components/Erfassung.test.tsx`); hier zählt nur, was der Browser zeigt: die Maske an der
 * Stelle, an der der Gutachter am Tablet getippt hat (60 px neben dem Dialog), und der Fokus.
 */
test('Vermisst melden: Klick neben den Dialog schließt nicht, Escape fragt, „Weiter bearbeiten“ behält den Fundort', async ({
  page,
}, info) => {
  await anmeldenPerApi(page, 'admin', process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw', {
    startseite: false,
  });
  const id = await einsatzPerApi(page, `Rückfrage ${Date.now()}`);
  await page.goto(`/einsaetze/${id}/personen`);
  await page.getByRole('button', { name: 'Vermisst melden' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Vermisst melden' });
  await expect(dialog).toBeVisible();
  const fundort = dialog.getByLabel('Fundort', { exact: true });
  await fundort.click();
  await page.keyboard.type('Hinter der Scheune');

  // 60 px neben dem Dialog, wie im Befund am Tablet.
  const box = (await dialog.boundingBox())!;
  await page.mouse.click(Math.max(box.x - 60, 5), box.y + box.height / 2);
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Eingaben verwerfen?' })).toHaveCount(0);

  // Der Fokus bleibt im Feld, sonst hörte niemand mehr Escape (`components/maskeHaeltFokus.ts`).
  await expect(fundort).toBeFocused();
  await page.keyboard.press('Escape');
  const rueckfrage = page.getByRole('dialog', { name: 'Eingaben verwerfen?' });
  await expect(rueckfrage).toBeVisible();
  await expect(rueckfrage).toContainText('Die Eingaben in „Vermisst melden“ gehen verloren.');
  await expect(rueckfrage.getByRole('button', { name: 'Weiter bearbeiten' })).toBeFocused();
  // Bild der Änderung erst nach der Einblende-Animation.
  await eingeblendet(rueckfrage);
  await page.screenshot({ path: info.outputPath('rueckfrage.png') });

  await rueckfrage.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(rueckfrage).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(fundort).toHaveValue('Hinter der Scheune');
  await expect(fundort).toBeFocused();
});
