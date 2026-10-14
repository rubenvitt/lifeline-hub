import { expect, test, type Page } from '@playwright/test';
import { stehendeAuswahl } from './auswahl-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Einsatzfunktion je Person (LLH-1067, Spec `personal-einsatzangaben`), Durchstich im Browser:
 * in der Personalliste aus den Vorschlägen gesetzt, steht sie im Meldebild vor der Qualifikation
 * und im ETB als ein Eintrag. Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

const NAME = `Funktion ${Date.now()}`;

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

test('Einsatzfunktion setzen: Meldebild nennt sie vor der Qualifikation, das ETB hält sie fest', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await post(page, '/api/einsaetze', { bezeichnung: `E2E ${NAME}` });
  const basis = `/api/einsaetze/${einsatzId}`;
  const einheitId = await post(page, `${basis}/einheiten`, { name: 'Sanitätsgruppe' });
  const epId = await post(page, `${basis}/personal`, {
    adhoc: { name: NAME, funktion: 'Notfallsanitäterin' },
  });
  // Im Meldebild stehen Personen unter ihrer Einheit.
  const zuordnung = await page.request.put(`${basis}/einheiten/${einheitId}/personal/${epId}`);
  expect(zuordnung.ok(), await zuordnung.text()).toBe(true);

  await page.goto(`/einsaetze/${einsatzId}/personal`);
  const region = page.getByRole('region', { name: 'Personal im Einsatz', exact: true });
  await expect(region.getByText(NAME)).toBeVisible();
  await region.getByRole('button', { name: `Funktion zu ${NAME} eintragen` }).click();
  const feld = region.getByRole('combobox', { name: `Funktion zu ${NAME}` });
  await feld.fill('sprech');
  const liste = await stehendeAuswahl(page);
  await liste
    .locator('.ant-select-item-option')
    .filter({ hasText: /^Sprechfunker$/ })
    .click();
  await expect(feld).toHaveValue('Sprechfunker');
  await region.getByRole('button', { name: `Funktion zu ${NAME} speichern` }).click();

  const wert = region.getByRole('button', { name: `Funktion zu ${NAME} bearbeiten` });
  await expect(wert).toHaveAccessibleDescription('Sprechfunker');
  // Die Qualifikation bleibt sichtbar unter der Einsatzfunktion.
  await expect(region.getByText('Notfallsanitäterin')).toBeVisible();

  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  const bereich = page.getByRole('region', { name: 'Meldebild' });
  await expect(bereich.locator(`tr[data-row-key="eh-${einheitId}"]`)).toBeVisible();
  await page.getByRole('radio', { name: 'alles', exact: true }).click();
  const zeile = bereich.locator(`tr[data-row-key="ep-${epId}"]`);
  await expect(zeile).toContainText(NAME);
  await expect(zeile).toContainText('Sprechfunker');
  await expect(zeile).not.toContainText('Notfallsanitäterin');

  const etb = await page.request.get(`${basis}/etb`);
  expect(etb.ok()).toBe(true);
  const inhalte = ((await etb.json()) as { inhalt: string }[])
    .map((e) => e.inhalt)
    .filter((i) => i.startsWith(`Person «${NAME}»`));
  expect(inhalte).toEqual([`Person «${NAME}»: Funktion «—» → «Sprechfunker»`]);
});
