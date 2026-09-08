import { expect, test, type Page } from '@playwright/test';

test.setTimeout(90_000);

async function vorbereiten(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(`E2E Router-Blocker ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/befehle`, {
    data: { vorlage: 'befehl_ladef', titel: 'Befehl Navigation' },
  });
  expect(antwort.ok(), await antwort.text()).toBe(true);
  const befehlId = (await antwort.json()).id as number;
  const api = `/api/einsaetze/${einsatzId}/befehle/${befehlId}`;
  const liste = `/einsaetze/${einsatzId}/auftraege`;
  const detail = `${liste}/befehle/${befehlId}`;
  return { api, liste, detail };
}

test('Speicherfehler hält die Brotkrume; Speichern und weiter persistiert vor der Navigation', async ({ page }) => {
  const { api, liste, detail } = await vorbereiten(page);
  let fehler = true;
  await page.route(`**${api}`, async (route) => {
    if (route.request().method() === 'PATCH' && fehler) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Speichern vorübergehend nicht möglich"}' });
    } else await route.continue();
  });
  await page.goto(detail);
  await page.getByLabel('Titel', { exact: true }).fill('Gesicherte neue Fassung');
  await page.getByRole('link', { name: 'Aufträge/Befehle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(detail);
  const speichern = dialog.getByRole('button', { name: 'Speichern und weiter', exact: true });
  await expect(speichern).not.toHaveClass(/ant-btn-loading/);
  fehler = false;
  await speichern.click();
  await expect(page).toHaveURL(liste);
  const gespeichert = await page.request.get(api);
  expect(gespeichert.ok()).toBe(true);
  expect((await gespeichert.json()).titel).toBe('Gesicherte neue Fassung');
});

test('Browser-Zurück: Bleiben behält die Fassung, Verwerfen führt den zweiten Versuch aus', async ({ page }) => {
  const { api, liste, detail } = await vorbereiten(page);
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await page.goto(liste);
  await page.getByRole('tab', { name: /Befehle/ }).click();
  await page.getByRole('link', { name: 'Befehl Navigation', exact: true }).click();
  await expect(page).toHaveURL(detail);
  // Ein abgelehnter PATCH hält die Fassung reproduzierbar offen; keine Zeitannahme.
  await page.route(`**${api}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline"}' });
    } else await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Titel', { exact: true }).fill('Offene Fassung');
  await page.evaluate(() => window.history.back());
  const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
  await expect(dialog).toBeVisible();
  for (const name of ['Verwerfen', 'Bleiben', 'Speichern und weiter']) {
    const knopf = dialog.getByRole('button', { name, exact: true });
    await expect(knopf).toBeVisible();
    // Modal-Zoom animiert zunächst die gesamte Trefffläche mit; erst den Endzustand messen.
    await expect.poll(async () => (await knopf.boundingBox())!.height).toBeGreaterThanOrEqual(72);
    const rechteck = await knopf.boundingBox();
    expect(rechteck!.height).toBeGreaterThanOrEqual(72);
    expect(rechteck!.x).toBeGreaterThanOrEqual(0);
    expect(rechteck!.x + rechteck!.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: test.info().outputPath('blocker-handschuh-390.png') });
  await dialog.getByRole('button', { name: 'Bleiben', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(detail);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Offene Fassung');
  await page.evaluate(() => window.history.back());
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page).toHaveURL(liste);
});
