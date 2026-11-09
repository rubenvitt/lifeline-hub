import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kontextmenü im Einsatztagebuch (LLH-1597, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/j161rpsm-kontextmenue-etb/design.md`) im echten Browser: Rechtsklick auf einen
 * Eintrag zeigt dieselben Einträge wie sein ⋮ und wirkt wie dieses; der Chip der Erfassung ebenso.
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

const menueMitName = (page: Page, name: string) =>
  page.locator(`.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label="${name}"]`);
const eintraegeVon = (menue: Locator) => menue.getByRole('menuitem').allInnerTexts();

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('Rechtsklick auf einen Eintrag zeigt die Einträge des ⋮; „Berichtigen“ wirkt wie dort', async ({
  page,
}) => {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Kontextmenü ETB ${Date.now()}`,
  });
  await post(page, `/api/einsaetze/${einsatzId}/etb`, {
    typ: 'meldung',
    inhalt: 'Wasserentnahme an Hydrant 4 bereit',
    von: 'ELW 1',
    an: 'Leitstelle',
  });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const zeile = page
    .locator('[data-testid="etb-ereigniszeile"]')
    .filter({ hasText: 'Wasserentnahme' });
  await expect(zeile).toHaveCount(1);

  // Die Quelle: das ⋮ derselben Zeile.
  const knopf = zeile.getByRole('button', { name: /^Aktionen zu Eintrag \d+$/ });
  const name = (await knopf.getAttribute('aria-label'))!;
  await knopf.click();
  const dreipunkt = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(dreipunkt.getByRole('menuitem').first()).toBeVisible();
  const punkte = await eintraegeVon(dreipunkt);
  expect(punkte).toContain('Berichtigen');
  await page.keyboard.press('Escape');
  await expect(dreipunkt).toHaveCount(0);

  await zeile.getByText('Wasserentnahme an Hydrant 4 bereit').click({ button: 'right' });
  const menue = menueMitName(page, name);
  await expect(menue).toBeVisible();
  expect(await eintraegeVon(menue)).toEqual(punkte);
  await expect(menue.getByRole('menuitem').first()).toBeFocused();

  await menue.getByRole('menuitem', { name: 'Berichtigen' }).click();
  await expect(menue).toHaveCount(0);
  await expect(page.getByText(/Berichtigung zu Nr\. \d+/).first()).toBeVisible();
});

test('Rechtsklick auf den Chip „An“ zeigt dessen Menü; „Bearbeiten“ öffnet das Feld', async ({
  page,
}) => {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Kontextmenü Chip ${Date.now()}`,
  });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const chip = page.locator('.ant-tag').filter({ hasText: /^An:/ });
  await expect(chip).toBeVisible();
  await chip.getByText(/^An:/).click({ button: 'right' });
  const menue = menueMitName(page, 'Aktionen zu An');
  await expect(menue).toBeVisible();
  const punkte = await eintraegeVon(menue);
  expect(punkte[0]).toMatch(/Bearbeiten|Nur für diesen Eintrag ändern/);
  await menue.getByRole('menuitem').first().click();
  await expect(page.getByRole('combobox', { name: 'An', exact: true })).toBeVisible();
});
