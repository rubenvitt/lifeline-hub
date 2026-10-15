import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Materialliste (LLH-1093, LLH-1225), Durchstich im Browser: Ort setzen und umhängen (das ETB nennt
 * den vorherigen Ort), eine Ad-hoc-Angabe korrigieren und einen Posten aufteilen (50 → 30 + 20).
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

async function post<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

async function etbInhalte(page: Page, einsatzId: string): Promise<string[]> {
  const etb = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  return ((await etb.json()) as { inhalt: string }[]).map((x) => x.inhalt);
}

async function seed(page: Page, bezeichnung: string, menge: number) {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Materialliste ${Date.now()}`,
  });
  const einsatzId = String(id);
  const basis = `/api/einsaetze/${einsatzId}`;
  await post(page, `${basis}/einheiten`, { name: 'Staffel A' });
  await post(page, `${basis}/einheiten`, { name: 'Staffel B' });
  await post(page, `${basis}/uhs`, { typ: 'behandlungsplatz', bezeichnung: 'Turnhalle' });
  await post(page, `${basis}/material`, { adhoc: { bezeichnung }, menge });
  return einsatzId;
}

const liste = (page: Page) =>
  page.getByRole('region', { name: 'Material im Einsatz', exact: true });

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('Ort setzen und wechseln: ein Ort je Posten, das ETB nennt den vorherigen (LLH-1224)', async ({
  page,
}) => {
  const einsatzId = await seed(page, 'Wolldecke', 20);
  await page.goto(`/einsaetze/${einsatzId}/material`);
  await expect(liste(page).getByText('Wolldecke')).toBeVisible();
  const ort = liste(page).getByTestId('material-ort');

  // Die eine Ortsangabe (LLH-1225 D3): wählen, dann „Speichern“.
  const selectOrt = async (option: string) => {
    await liste(page).getByRole('button', { name: 'Ort zu Wolldecke bearbeiten' }).click();
    await page.getByRole('combobox', { name: 'Ort zu Wolldecke' }).click();
    await page.getByRole('option', { name: option }).click();
    await page.getByRole('button', { name: 'Ort zu Wolldecke speichern' }).click();
  };
  await selectOrt('Staffel A');
  await expect(ort).toHaveText(/Staffel A/);

  // An die UHS: der Posten wechselt, die Einheit geht.
  await selectOrt('UHS Turnhalle');
  await expect(ort).toContainText('UHS Turnhalle');
  await expect(ort).not.toContainText('Staffel A');

  // Zurück an eine Einheit: die UHS geht.
  await selectOrt('Staffel B');
  await expect(ort).toContainText('Staffel B');
  await expect(ort).not.toContainText('Turnhalle');

  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toEqual(
      expect.arrayContaining([
        'Material «Wolldecke» (×20): ohne Ort → Einheit «Staffel A»',
        'Material «Wolldecke» (×20): Einheit «Staffel A» → UHS «Turnhalle»',
        'Material «Wolldecke» (×20): UHS «Turnhalle» → Einheit «Staffel B»',
      ]),
    );
});

test('eine Ad-hoc-Angabe korrigieren und einen Posten aufteilen', async ({ page }) => {
  const einsatzId = await seed(page, 'Feldbeten', 50);
  await page.goto(`/einsaetze/${einsatzId}/material`);
  await expect(liste(page).getByText('Feldbeten')).toBeVisible();

  // „Angaben ändern“ im Zeilenmenü.
  await liste(page).getByRole('button', { name: 'Weitere Aktionen zu Feldbeten' }).click();
  await page.getByRole('menuitem', { name: 'Angaben ändern …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Angaben zu Feldbeten ändern' });
  const bezeichnung = dialog.getByLabel('Bezeichnung');
  await expect(bezeichnung).toHaveValue('Feldbeten');
  await bezeichnung.fill('Feldbetten');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(liste(page).getByText('Feldbetten')).toBeVisible();
  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toContain('Material «Feldbetten»: Bezeichnung «Feldbeten» → «Feldbetten»');

  // Aufteilen 50 → 30 + 20.
  await liste(page).getByRole('button', { name: 'Weitere Aktionen zu Feldbetten' }).click();
  await page.getByRole('menuitem', { name: 'Aufteilen …' }).click();
  const aufteilen = page.getByRole('dialog', { name: 'Feldbetten aufteilen' });
  await aufteilen.getByRole('spinbutton', { name: 'Menge abteilen' }).fill('20');
  await expect(aufteilen.getByText('Danach 30 + 20')).toBeVisible();
  await aufteilen.getByRole('button', { name: 'Aufteilen' }).click();
  await expect(aufteilen).toHaveCount(0);
  // Die Menge ist ein Wert in der Zeile, kein Feld (LLH-1225 D5).
  const zeilen = liste(page).locator('[data-row-key]').filter({ hasText: 'Feldbetten' });
  await expect(zeilen).toHaveCount(2);
  await expect(zeilen.getByText('30', { exact: true })).toHaveCount(1);
  await expect(zeilen.getByText('20', { exact: true })).toHaveCount(1);
  await expect(page.getByText('2 Posten')).toBeVisible();
  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toContain('Material «Feldbetten» aufgeteilt: 50 → 30 + 20');
});
