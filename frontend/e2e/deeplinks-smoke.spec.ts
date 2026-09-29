import { expect, test, type Page } from '@playwright/test';

// Browser-Smoke der jsdom-blinden Deeplink-Mechanismen: <Navigate>-Redirect bei ungültiger
// Detail-ID und ?eintrag=-Highlight/Scroll im ETB (reales Router-/DOM-Verhalten).

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegenUndOeffnen(page: Page): Promise<number> {
  const name = `E2E Deeplink ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  // Anlegen navigiert direkt in den neuen Einsatz (/einsaetze/:id/<default-modul>).
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
}

test('ungültige Detail-ID leitet im Browser auf die Modul-Liste um (NaN-Guard)', async ({
  page,
}) => {
  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  await page.goto(`/einsaetze/${eid}/personen/abc`);
  // <Navigate replace> → Personen-Liste (ohne /:personId)
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${eid}/personen$`));
});

test('ETB-Deeplink ?eintrag= hebt den adressierten Eintrag im Browser hervor', async ({ page }) => {
  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  await page.goto(`/einsaetze/${eid}/etb`);

  const inhalt = `Smoke-Eintrag ${Date.now()}`;
  await page.getByPlaceholder('Inhalt …').fill(inhalt);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  /*
   * Das Tagebuch ist eine Zeitachse ohne `<tr>`. Die Zeile trägt die Marke
   * `data-lfh="datensicht-karte"` (daran findet `scrolleZurZeile` sie) und ihren Schlüssel in
   * `data-zeile`.
   */
  const sicht = page.getByRole('region', { name: 'Einsatztagebuch' });
  const zeile = sicht.getByTestId('etb-ereigniszeile').filter({ hasText: inhalt });
  await expect(zeile).toBeVisible();
  const zeilenSchluessel = await zeile.getAttribute('data-zeile');
  expect(zeilenSchluessel).toBeTruthy();
  /*
   * Der Zeilenschlüssel trägt das Sortenpräfix (`eintrag-<id>`), damit die Queue-`id` eines
   * offline gepufferten Eintrags nicht mit der DB-`id` kollidiert. Der Query-Param nimmt die
   * nackte DB-`id` — `?eintrag=eintrag-9` fiele an `parseRouteId` still durch.
   */
  const eintragId = zeilenSchluessel!.replace(/^eintrag-/, '');
  expect(eintragId).toMatch(/^\d+$/);

  // Ohne Deeplink ist die Zeile NICHT hervorgehoben — sonst belegte die Aussage unten nichts.
  await expect(zeile).not.toHaveClass(/zeile-hervorgehoben/);

  // Deeplink auf den Eintrag → Highlight-Klasse muss an genau dieser Zeile erscheinen.
  await page.goto(`/einsaetze/${eid}/etb?eintrag=${eintragId}`);
  const ziel = page.locator(`[data-testid="etb-ereigniszeile"][data-zeile="${zeilenSchluessel}"]`);
  await expect(ziel).toHaveClass(/zeile-hervorgehoben/);
  await expect(ziel).toBeInViewport();
});
