import { expect, test, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';

/**
 * Paneel „Ablauf“ der Einsatzdaten (LLH-1570, Spec `ablaufplan`) im echten Browser: anlegen im
 * Dialog, Uhrzeit in der Zeile ändern, löschen. Geprüft wird am gespeicherten Stand des Servers;
 * die Zone des Browsers (Europe/Berlin) macht die UTC-Wandlung scharf (Muster
 * `einsatzdaten-inline.spec.ts`).
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.use({ timezoneId: 'Europe/Berlin' });

async function anmeldenUndAnlegen(page: Page): Promise<number> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Ablauf ${Date.now()}` },
  });
  expect(antwort.ok()).toBeTruthy();
  return (await antwort.json()).id as number;
}

async function punkte(
  page: Page,
  id: number,
): Promise<{ id: number; bezeichnung: string; zeitpunkt_at: string }[]> {
  return (await (await page.request.get(`/api/einsaetze/${id}/programmpunkte`)).json()) as {
    id: number;
    bezeichnung: string;
    zeitpunkt_at: string;
  }[];
}

test('LLH-1570: Programmpunkt anlegen, Uhrzeit ändern, löschen', async ({ page }) => {
  const id = await anmeldenUndAnlegen(page);
  await page.goto(einsatzdatenPfad(id));
  const ablauf = page.getByRole('region', { name: 'Ablauf' });
  await expect(ablauf.getByText('Kein Programmpunkt')).toBeVisible();

  await ablauf.getByRole('button', { name: 'Programmpunkt', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Programmpunkt anlegen' });
  await dialog.getByLabel('Bezeichnung').fill('Feuerwerk');
  // 22:00 Ortszeit am 13.09.2026 (MESZ) = 20:00 UTC; Enter übernimmt und sendet.
  const zeit = dialog.getByLabel('Zeitpunkt');
  await zeit.fill('132200sep26');
  await zeit.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(ablauf.getByText('Feuerwerk')).toBeVisible();
  await expect
    .poll(async () => (await punkte(page, id)).map((p) => [p.bezeichnung, p.zeitpunkt_at]))
    .toEqual([['Feuerwerk', '2026-09-13 20:00:00']]);

  await ablauf.getByRole('button', { name: 'Zeitpunkt zu Feuerwerk bearbeiten' }).click();
  const feld = ablauf.getByRole('textbox', { name: /Zeitpunkt/ });
  await feld.fill('132230sep26');
  await feld.press('Enter');
  await expect
    .poll(async () => (await punkte(page, id))[0]?.zeitpunkt_at)
    .toBe('2026-09-13 20:30:00');

  await ablauf.getByRole('button', { name: 'Feuerwerk löschen' }).click();
  await page.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(ablauf.getByText('Kein Programmpunkt')).toBeVisible();
  expect(await punkte(page, id)).toEqual([]);
});
