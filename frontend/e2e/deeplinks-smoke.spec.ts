import { expect, test, type Page } from '@playwright/test';

// Browser-Smoke der jsdom-blinden Deeplink-Mechanismen (LFH-25): <Navigate>-Redirect bei
// strukturell ungültiger Detail-ID und ?eintrag=-Highlight/Scroll im ETB. Die href-Generierung
// und die State-Konsumierung sind in den Unit-Tests abgedeckt; hier geht es um das reale
// Router-/DOM-Verhalten.

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

test('ungültige Detail-ID leitet im Browser auf die Modul-Liste um (NaN-Guard)', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Erfassen' }).click();

  const zeile = page.locator('tr', { hasText: inhalt });
  await expect(zeile).toBeVisible();
  const eintragId = await zeile.getAttribute('data-row-key');
  expect(eintragId).toBeTruthy();

  // Deeplink auf den Eintrag → Highlight-Klasse muss am <tr> erscheinen.
  await page.goto(`/einsaetze/${eid}/etb?eintrag=${eintragId}`);
  await expect(page.locator(`tr[data-row-key="${eintragId}"]`)).toHaveClass(/zeile-hervorgehoben/);
});
