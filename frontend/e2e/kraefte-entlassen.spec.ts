import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kräfte entlassen statt löschen (LLH-1079), Durchstich im Browser: „Entlassen“ in der
 * Personenansicht (seit LLH-1060 nur dort) schreibt die Entlassung in die Zeitachse der Person;
 * die Ansicht bleibt lesbar mit der Marke „entlassen“, die Liste legt die Person in den Block
 * „Entlassen“, dessen Name zurück in die Ansicht führt. Der Rückgängig-Hinweis disponiert sie
 * wieder, ihre Zeitachse bleibt mit der Entlassung stehen. Gewartet wird auf Inhaltsanker, nie
 * auf `networkidle` (LFH-385).
 */

const NAME = 'Entlassen, Erika';

async function seedePerson(page: Page): Promise<string> {
  const einsatz = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Entlassen ${Date.now()}` },
  });
  expect(einsatz.ok(), await einsatz.text()).toBe(true);
  const einsatzId = String(((await einsatz.json()) as { id: number }).id);
  const kraft = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
    data: { adhoc: { name: NAME, funktion: 'Sanitäterin' } },
  });
  expect(kraft.ok(), await kraft.text()).toBe(true);
  const id = ((await kraft.json()) as { id: number }).id;
  // Eine offene Periode: nur dann geht die Entlassung in die Zeitachse. Das Eintreffen liegt
  // jetzt, nicht davor: die Disposition hat die Alarmierung eben geschrieben.
  const nachtrag = await page.request.post(`/api/einsaetze/${einsatzId}/personal/${id}/zeitachse`, {
    data: { art: 'eintreffen', zeitpunkt_at: new Date().toISOString() },
  });
  expect(nachtrag.ok(), await nachtrag.text()).toBe(true);
  return einsatzId;
}

test('Entlassen aus der Ansicht legt die Kraft in den Block „Entlassen“, Rückgängig holt sie mit Zeitachse zurück', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await seedePerson(page);
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  const region = page.getByRole('region', { name: 'Personal im Einsatz', exact: true });
  // Die Liste trägt keine Löschbedienung; der Name öffnet die Ansicht.
  await expect(region.getByRole('link', { name: NAME })).toBeVisible();
  await expect(region.getByRole('button', { name: `${NAME} entlassen` })).toHaveCount(0);
  await region.getByRole('link', { name: NAME }).click();
  const main = page.getByRole('main');
  const titel = page.getByRole('heading', { level: 1 });
  await expect(titel).toContainText(NAME);

  // Umkehrbar: keine Rückfrage, der Hinweis bietet „Rückgängig“.
  await main.getByRole('button', { name: `${NAME} entlassen` }).click();
  const hinweis = page.locator('.ant-message-notice').filter({ hasText: `${NAME} entlassen` });
  await expect(hinweis).toBeVisible();
  // Die Ansicht bleibt lesbar: Marke „entlassen“, „Erneut disponieren“ statt „Entlassen“.
  await expect(titel).toContainText('entlassen');
  await expect(main.getByRole('button', { name: 'Erneut disponieren' })).toBeVisible();

  // Die Zeitachse trägt die Entlassung aus der Disposition.
  const ereignisse = main.locator('[data-lfh="zeitachse-ereignis"]');
  await expect(ereignisse.filter({ hasText: 'Entlassung' })).toHaveCount(1);
  await expect(ereignisse.filter({ hasText: 'aus dem Einsatz entlassen' })).toHaveCount(1);

  await hinweis.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(main.getByRole('button', { name: `${NAME} entlassen` })).toBeVisible();
  await expect(titel).not.toContainText('entlassen');
  // Die Zeitachse bleibt mit der Entlassung stehen.
  await expect(ereignisse.filter({ hasText: 'Entlassung' })).toHaveCount(1);

  // Erneut entlassen, dann über die Brotkrume zur Liste: dort steht der Block „Entlassen“.
  await main.getByRole('button', { name: `${NAME} entlassen` }).click();
  await expect(titel).toContainText('entlassen');
  await page
    .locator('.ant-breadcrumb')
    .getByRole('link', { name: 'Personal', exact: true })
    .click();
  await expect(region.getByRole('link', { name: NAME })).toHaveCount(0);
  const block = page.locator('[data-lfh="entlassen-block"]');
  await block.getByText('Entlassen (1)').click();
  const eintrag = block.getByRole('list', { name: 'Entlassen' }).getByRole('link', { name: NAME });
  await expect(eintrag).toHaveAttribute(
    'href',
    new RegExp(`/einsaetze/${einsatzId}/personal/\\d+$`),
  );
  await eintrag.click();
  await expect(titel).toContainText(NAME);
  await expect(titel).toContainText('entlassen');
});
