import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Materialliste (LLH-1093), Durchstich im Browser: Ort setzen und umhängen (das ETB nennt die
 * vorherige Einheit), eine Ad-hoc-Angabe korrigieren und einen Posten aufteilen (50 → 30 + 20).
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

async function seede(page: Page, bezeichnung: string, menge: number) {
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
  const einsatzId = await seede(page, 'Wolldecke', 20);
  await page.goto(`/einsaetze/${einsatzId}/material`);
  await expect(liste(page).getByText('Wolldecke')).toBeVisible();
  const ort = liste(page).getByTestId('material-ort');

  // Einheit eintragen: wählen, dann „Speichern“.
  await liste(page).getByRole('button', { name: 'Einheit zu Wolldecke eintragen' }).click();
  await page.getByRole('combobox', { name: 'Einheit zu Wolldecke' }).click();
  await page.getByRole('option', { name: 'Staffel A' }).click();
  await page.getByRole('button', { name: 'Einheit zu Wolldecke speichern' }).click();
  await expect(
    liste(page).getByRole('button', { name: 'Einheit zu Wolldecke bearbeiten' }),
  ).toHaveText(/Staffel A/);

  // UHS eintragen: der Posten wechselt an die UHS, die Einheit wird leer.
  await liste(page).getByRole('button', { name: 'UHS zu Wolldecke eintragen' }).click();
  await page.getByRole('combobox', { name: 'UHS zu Wolldecke' }).click();
  await page.getByRole('option', { name: 'UHS Turnhalle' }).click();
  await page.getByRole('button', { name: 'UHS zu Wolldecke speichern' }).click();
  await expect(ort).toContainText('UHS Turnhalle');
  await expect(ort).not.toContainText('Staffel A');
  await expect(
    liste(page).getByRole('button', { name: 'Einheit zu Wolldecke eintragen' }),
  ).toBeVisible();

  // Zurück an eine Einheit: die UHS wird leer.
  await liste(page).getByRole('button', { name: 'Einheit zu Wolldecke eintragen' }).click();
  await page.getByRole('combobox', { name: 'Einheit zu Wolldecke' }).click();
  await page.getByRole('option', { name: 'Staffel B' }).click();
  await page.getByRole('button', { name: 'Einheit zu Wolldecke speichern' }).click();
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
  const einsatzId = await seede(page, 'Feldbeten', 50);
  await page.goto(`/einsaetze/${einsatzId}/material`);
  await expect(liste(page).getByText('Feldbeten')).toBeVisible();

  // „Angaben ändern“ im Zeilenmenü.
  await liste(page).getByRole('button', { name: 'Weitere Aktionen zu Feldbeten' }).click();
  await page.getByRole('menuitem', { name: 'Angaben ändern' }).click();
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
  await page.getByRole('menuitem', { name: 'Aufteilen' }).click();
  const aufteilen = page.getByRole('dialog', { name: 'Feldbetten aufteilen' });
  await aufteilen.getByRole('spinbutton', { name: 'Menge abteilen' }).fill('20');
  await expect(aufteilen.getByText('Danach 30 + 20')).toBeVisible();
  await aufteilen.getByRole('button', { name: 'Aufteilen' }).click();
  await expect(aufteilen).toHaveCount(0);
  const mengen = liste(page).getByRole('button', { name: 'Menge zu Feldbetten bearbeiten' });
  await expect(mengen).toHaveCount(2);
  await expect(mengen.filter({ hasText: '30' })).toHaveCount(1);
  await expect(mengen.filter({ hasText: '20' })).toHaveCount(1);
  await expect(page.getByText('2 Posten')).toBeVisible();
  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toContain('Material «Feldbetten» aufgeteilt: 50 → 30 + 20');
});
