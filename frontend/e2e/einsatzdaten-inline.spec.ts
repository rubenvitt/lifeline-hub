import { expect, test, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';

/**
 * Einsatzdaten zeilenweise bearbeiten (LFH-472) im echten Browser.
 *
 * Der Vitest-Nachweis läuft gegen jsdom; hier zählt, was jsdom nicht kann: der antd-DatePicker
 * übernimmt eine getippte Zeit per Enter wirklich, und die Zone des Browsers (Europe/Berlin) macht
 * die UTC-Wandlung scharf. Geprüft wird am gespeicherten Stand des Servers, nicht am Request.
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
    data: { bezeichnung: `E2E Einsatzdaten inline ${Date.now()}` },
  });
  expect(antwort.ok()).toBeTruthy();
  return (await antwort.json()).id as number;
}

async function stand(page: Page, id: number): Promise<Record<string, unknown>> {
  return (await (await page.request.get(`/api/einsaetze/${id}`)).json()) as Record<string, unknown>;
}

test('LFH-472: Leitstellen-Nr. inline nachtragen, die Leseansicht bleibt stehen', async ({
  page,
}) => {
  const id = await anmeldenUndAnlegen(page);
  await page.goto(einsatzdatenPfad(id));
  await page.getByRole('button', { name: /Technische Angaben/ }).click();
  await page.getByRole('button', { name: 'Leitstellen-Nr. eintragen', exact: true }).click();

  const feld = page.getByRole('textbox', { name: 'Leitstellen-Nr.', exact: true });
  await expect(feld).toBeFocused();
  // Die übrigen Angaben stehen weiter da, das Vollformular ist nicht offen.
  await expect(page.getByText('Lagedaten', { exact: true })).toBeVisible();
  await expect(page.getByText('Einsatzdaten bearbeiten', { exact: true })).toHaveCount(0);

  await feld.fill('ILS-4711');
  await feld.press('Enter');
  const wertKnopf = page.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten', exact: true });
  await expect(wertKnopf).toBeFocused();
  await expect(wertKnopf).toContainText('ILS-4711');
  expect((await stand(page, id)).leitstellen_nr).toBe('ILS-4711');
});

test('LFH-472: Alarmzeit inline — Enter übernimmt, gespeichert wird der absolute Zeitpunkt', async ({
  page,
}) => {
  const id = await anmeldenUndAnlegen(page);
  await page.goto(einsatzdatenPfad(id));
  await page.getByRole('button', { name: 'Alarmzeit bearbeiten', exact: true }).click();

  // 03:30 Ortszeit am 29.03.2026 liegt nach der Umstellung (MESZ) = 01:30 UTC.
  const feld = page.getByRole('textbox', { name: 'Alarmzeit', exact: true });
  await feld.fill('2026-03-29 03:30:00');
  await feld.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Alarmzeit bearbeiten', exact: true }),
  ).toBeVisible();
  expect((await stand(page, id)).begonnen_at).toBe('2026-03-29 01:30:00');
});

test('LFH-472: Alarmzeit geleert wird abgelehnt, der Stand bleibt', async ({ page }) => {
  const id = await anmeldenUndAnlegen(page);
  const vorher = (await stand(page, id)).begonnen_at;
  await page.goto(einsatzdatenPfad(id));
  await page.getByRole('button', { name: 'Alarmzeit bearbeiten', exact: true }).click();

  const picker = page
    .locator('.ant-picker')
    .filter({ has: page.getByRole('textbox', { name: 'Alarmzeit', exact: true }) });
  await picker.hover();
  await picker.locator('.ant-picker-clear').click();
  await page.getByRole('button', { name: 'Alarmzeit speichern', exact: true }).click();

  await expect(
    page.getByText('Alarmzeit ist eine Pflichtangabe — der bisherige Wert bleibt.', {
      exact: true,
    }),
  ).toBeVisible();
  expect((await stand(page, id)).begonnen_at).toBe(vorher);
});
