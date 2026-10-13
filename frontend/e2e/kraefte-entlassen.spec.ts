import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kräfte entlassen statt löschen (LLH-1079), Durchstich im Browser: „Entlassen“ an der Zeile
 * schreibt die Entlassung in die Zeitachse der Person und legt sie in den Block „Entlassen“; der
 * Rückgängig-Hinweis disponiert sie wieder, ihre Zeitachse bleibt mit der Entlassung stehen.
 * Gewartet wird auf Inhaltsanker, nie auf `networkidle` (LFH-385).
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

test('Entlassen legt die Kraft in den Block „Entlassen“, Rückgängig holt sie mit Zeitachse zurück', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await seedePerson(page);
  await page.goto(`/einsaetze/${einsatzId}/personal`);
  const region = page.getByRole('region', { name: 'Personal im Einsatz', exact: true });
  await expect(region.getByText(NAME)).toBeVisible();

  // Umkehrbar: keine Rückfrage, der Hinweis bietet „Rückgängig“.
  await region.getByRole('button', { name: `${NAME} entlassen` }).click();
  const hinweis = page.locator('.ant-message-notice').filter({ hasText: `${NAME} entlassen` });
  await expect(hinweis).toBeVisible();
  await expect(region.getByText(NAME)).toHaveCount(0);
  const block = page.locator('[data-lfh="entlassen-block"]');
  await expect(block.getByText('Entlassen (1)')).toBeVisible();
  await block.getByText('Entlassen (1)').click();
  await expect(block.getByRole('list', { name: 'Entlassen' }).getByText(NAME)).toBeVisible();

  await hinweis.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(region.getByText(NAME)).toBeVisible();
  await expect(block).toHaveCount(0);

  // Die Zeitachse trägt die Entlassung aus der Disposition.
  await region.getByRole('button', { name: `Zeitachse zu ${NAME}` }).click();
  const ereignisse = region.locator('[data-lfh="zeitachse-ereignis"]');
  await expect(ereignisse.filter({ hasText: 'Entlassung' })).toHaveCount(1);
  await expect(ereignisse.filter({ hasText: 'aus dem Einsatz entlassen' })).toHaveCount(1);
});
