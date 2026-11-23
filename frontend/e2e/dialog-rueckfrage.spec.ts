import { expect, test, type Locator, type Page } from '@playwright/test';
import { dialogSteht, eingeblendet } from './dialog-kern';
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

/**
 * LLH-2013: „Weiter bearbeiten“ ist vorgewählt, und Enter führt zurück ins Feld, beim ersten und
 * jedem weiteren Öffnen. Im Browser zieht rc-dialogs Fokusfalle den Fokus weg (erst auf das Kreuz
 * des Dialogs dahinter, dann auf das der Rückfrage), und ab dem zweiten Öffnen setzte rc-dialog
 * ihn auf den Rahmen der Rückfrage; jsdom sieht beides nicht. Geprüft wird nach der Einblendung,
 * weil der Fokus dort erst eingeschwungen ist.
 */
async function enterFuehrtZurueck(page: Page, feld: Locator, text: string) {
  for (const runde of [1, 2]) {
    await page.keyboard.press('Escape');
    const rueckfrage = await eingeblendet(
      page.getByRole('dialog', { name: 'Eingaben verwerfen?' }),
    );
    await expect(
      rueckfrage.getByRole('button', { name: 'Weiter bearbeiten' }),
      `Runde ${runde}`,
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(rueckfrage, `Runde ${runde}`).toBeHidden();
    await expect(feld).toHaveValue(text);
    await expect(feld).toBeFocused();
  }
}

test('Erfassungshülle „Auftrag erteilen“: Enter in der Rückfrage führt zurück ins Feld, auch beim zweiten Mal', async ({
  page,
}) => {
  await anmeldenPerApi(page, 'admin', process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw', {
    startseite: false,
  });
  const id = await einsatzPerApi(page, `Rückfrage Fokus ${Date.now()}`);
  await page.goto(`/einsaetze/${id}/auftraege`);
  await page.getByRole('button', { name: 'Auftrag erteilen' }).first().click();
  const dialog = await dialogSteht(page, 'Auftrag erteilen');
  const was = dialog.getByLabel('Auftrag / Was');
  await was.click();
  await page.keyboard.type('Hydrant H12 freilegen');

  await enterFuehrtZurueck(page, was, 'Hydrant H12 freilegen');
  await expect(dialog).toBeVisible();
});

test('„Vollzug melden“ (useVerwerfenSchutz): Enter in der Rückfrage führt zurück ins Feld, auch beim zweiten Mal', async ({
  page,
}) => {
  await anmeldenPerApi(page, 'admin', process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw', {
    startseite: false,
  });
  const id = await einsatzPerApi(page, `Rückfrage Vollzug ${Date.now()}`);
  const r = await page.request.post(`/api/einsaetze/${id}/auftraege`, {
    data: {
      auftrag_text: 'Hydrant H12 freilegen',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
    },
  });
  expect(r.ok(), `Auftrag: ${r.status()}`).toBe(true);
  await page.goto(`/einsaetze/${id}/auftraege`);
  const detail = page.locator('[data-lfh="liste-detail-detail"]');
  await detail.getByRole('button', { name: 'Empfang für EA Nord quittieren' }).click();
  await page.getByRole('button', { name: 'Empfang quittieren' }).click();
  await detail.getByRole('button', { name: 'Vollzug melden' }).click();
  const vollzug = await dialogSteht(page, 'Vollzug melden');
  const meldung = vollzug.getByPlaceholder('Rückmeldung zur Erledigung');
  await meldung.click();
  await page.keyboard.type('Hydrant frei');

  await enterFuehrtZurueck(page, meldung, 'Hydrant frei');
  await expect(vollzug).toBeVisible();
});
