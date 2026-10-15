import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Materialliste mit einem Ort und „Ausgeben“ (LLH-1225 Teil I), Durchstich im Browser: ein
 * Verbrauchsgut ausgeben und eine Ausgabe zurücknehmen (die Zeile nennt den Rest, das ETB die
 * Änderung), dann den Ort über die eine Angabe von einer Einheit an eine UHS wechseln — die
 * Gruppierung „Nach Ort“ zieht die Zeile mit. Gewartet wird auf Inhaltsanker, nie auf
 * `networkidle` (LFH-385).
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

async function seed(page: Page) {
  const { id } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Material Ort Ausgabe ${Date.now()}`,
  });
  const einsatzId = String(id);
  const basis = `/api/einsaetze/${einsatzId}`;
  const einheit = await post(page, `${basis}/einheiten`, { name: 'Staffel A' });
  await post(page, `${basis}/uhs`, { typ: 'behandlungsplatz', bezeichnung: 'Turnhalle' });
  await post(page, `${basis}/material`, {
    adhoc: { bezeichnung: 'Wolldecke' },
    menge: 50,
    art: 'verbrauchsgut',
    einheit_id: einheit.id,
  });
  return einsatzId;
}

const liste = (page: Page) =>
  page.getByRole('region', { name: 'Material im Einsatz', exact: true });
const gruppenZaehler = (page: Page) => page.locator('[data-lfh="datensicht-gruppenzaehler"]');

test.beforeEach(async ({ page }) => {
  await anmeldenAlsAdmin(page);
});

test('ausgeben, zurücknehmen und den Ort wechseln: Rest, ETB und Gruppe folgen (LLH-1225)', async ({
  page,
}) => {
  const einsatzId = await seed(page);
  await page.goto(`/einsaetze/${einsatzId}/material`);
  const zeile = liste(page).locator('[data-row-key]').filter({ hasText: 'Wolldecke' });
  await expect(zeile.getByText('50', { exact: true })).toBeVisible();

  // Ausgeben 20: der Dialog nennt den Stand danach, die Zeile den Rest.
  await liste(page).getByRole('button', { name: 'Wolldecke ausgeben' }).click();
  const ausgeben = page.getByRole('dialog', { name: 'Wolldecke ausgeben' });
  await ausgeben.getByRole('spinbutton', { name: 'Menge ausgeben' }).fill('20');
  await expect(ausgeben.getByTestId('ausgabe-danach')).toHaveText(/30 von 50 übrig/);
  await ausgeben.getByRole('button', { name: 'Ausgeben' }).click();
  await expect(ausgeben).toHaveCount(0);
  await expect(page.getByText('Wolldecke: 20 ausgegeben')).toBeVisible();
  await expect(zeile).toContainText('30 von 50 übrig');

  // Zurücknehmen 5 über das Zeilenmenü.
  await liste(page).getByRole('button', { name: 'Weitere Aktionen zu Wolldecke' }).click();
  await page.getByRole('menuitem', { name: 'Ausgabe zurücknehmen …' }).click();
  const zurueck = page.getByRole('dialog', { name: 'Ausgabe von Wolldecke zurücknehmen' });
  await zurueck.getByRole('spinbutton', { name: 'Menge zurücknehmen' }).fill('5');
  await zurueck.getByRole('button', { name: 'Zurücknehmen' }).click();
  await expect(zurueck).toHaveCount(0);
  await expect(zeile).toContainText('35 von 50 übrig');

  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toEqual(
      expect.arrayContaining([
        'Material «Wolldecke»: Ausgabe 0 → 20 (Rest 30 von 50)',
        'Material «Wolldecke»: Ausgabe 20 → 15 (Rest 35 von 50)',
      ]),
    );

  // Ort Einheit → UHS: eine Angabe, ein PATCH; die Gruppe „Nach Ort“ wechselt.
  await expect(gruppenZaehler(page)).toHaveText('1 Staffel A');
  await liste(page).getByRole('button', { name: 'Ort zu Wolldecke bearbeiten' }).click();
  await page.getByRole('combobox', { name: 'Ort zu Wolldecke' }).click();
  await page.getByRole('option', { name: 'UHS Turnhalle' }).click();
  await page.getByRole('button', { name: 'Ort zu Wolldecke speichern' }).click();
  await expect(liste(page).getByRole('button', { name: 'Ort zu Wolldecke bearbeiten' })).toHaveText(
    /UHS Turnhalle/,
  );
  await expect(gruppenZaehler(page)).toHaveText('1 UHS Turnhalle');
  await expect
    .poll(() => etbInhalte(page, einsatzId))
    .toContain('Material «Wolldecke» (×50): Einheit «Staffel A» → UHS «Turnhalle»');
});
