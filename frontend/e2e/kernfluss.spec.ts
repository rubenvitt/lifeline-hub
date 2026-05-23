import { expect, test, type Page } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzOeffnen(page: Page, name: string) {
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Öffnen' })
    .click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('Login → Einsatz → Eintrag live in zweitem Client', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await anmelden(a);

  // Einsatz anlegen (eindeutige Bezeichnung pro Lauf)
  const name = `E2E Einsatz ${Date.now()}`;
  await a.getByRole('button', { name: 'Einsatz anlegen' }).click();
  await a.getByLabel('Bezeichnung').fill(name);
  await a.getByRole('button', { name: 'Anlegen' }).click();
  await expect(a.getByText(name)).toBeVisible();

  await einsatzOeffnen(a, name);

  // Zweiter Client öffnet denselben Einsatz und wartet auf Live-Eintrag
  await anmelden(b);
  await einsatzOeffnen(b, name);

  // A erfasst einen Eintrag
  const inhalt = `Live-Test ${Date.now()}`;
  await a.getByPlaceholder('Inhalt …').fill(inhalt);
  await a.getByRole('button', { name: 'Erfassen' }).click();
  await expect(a.getByText(inhalt)).toBeVisible();

  // B sieht den Eintrag ohne manuelles Neuladen (SSE-Live)
  await expect(b.getByText(inhalt)).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
