import { expect, test, type Page } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Legt einen Einsatz an und liefert seine DB-id; die Anlegen-Mutation navigiert in den
 *  Einsatz, die id steckt danach in der URL. */
async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

// Smoke-Kernfluss: Login → Einsatz anlegen → ETB-Eintrag erfassen → derselbe Eintrag erscheint
// live (SSE, kein Reload) im ETB eines zweiten Clients. Beide Clients steuern nach dem Anlegen
// direkt die ETB-Modul-URL an.
test('Login → Einsatz → Eintrag live in zweitem Client', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // A legt den Einsatz an und öffnet dessen ETB.
  await anmelden(a);
  const name = `E2E Einsatz ${Date.now()}`;
  const einsatzId = await einsatzAnlegen(a, name);
  await a.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(a.getByPlaceholder('Inhalt …')).toBeVisible();

  // B öffnet dasselbe ETB und wird erst interaktiv (Erfassungsfeld sichtbar), BEVOR A absendet:
  // sonst verpasste Bs noch nicht verbundene EventSource das Event (kein Refetch-Fallback).
  await anmelden(b);
  await b.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(b.getByPlaceholder('Inhalt …')).toBeVisible();

  // A erfasst einen Eintrag.
  const inhalt = `Live-Test ${Date.now()}`;
  await a.getByPlaceholder('Inhalt …').fill(inhalt);
  await a.getByRole('button', { name: 'Erfassen', exact: true }).click();

  // Eindeutig über die Region „Einsatztagebuch" und die Ereigniszeile — ein seitenweites
  // `getByText` träfe transient auch das live spiegelnde Entwurf-Tab-Label.
  const eintragBei = (p: Page) =>
    p
      .getByRole('region', { name: 'Einsatztagebuch' })
      .getByTestId('etb-ereigniszeile')
      .filter({ hasText: inhalt });
  await expect(eintragBei(a)).toBeVisible();

  // B sieht den Eintrag ohne manuelles Neuladen (SSE-Live).
  await expect(eintragBei(b)).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
