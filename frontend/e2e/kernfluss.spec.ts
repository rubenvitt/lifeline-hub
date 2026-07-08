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

/** Legt einen Einsatz an und liefert seine DB-id. Die Anlegen-Mutation navigiert
 *  automatisch in den Einsatz (Default-Modul) — die id steckt danach in der URL. */
async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

// Smoke-Kernfluss: Login → Einsatz anlegen → ETB-Eintrag erfassen → derselbe Eintrag
// erscheint live (SSE, kein Reload) im ETB eines zweiten Clients. Umgeht — wie
// etb-entwurf-tabs.spec.ts (LFH-142) — die Modul-Navigation, indem beide Clients nach
// dem Anlegen direkt die ETB-Modul-URL /einsaetze/:id/etb ansteuern.
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

  // B öffnet dasselbe ETB. Erst warten, bis Bs ETB interaktiv ist (Erfassungsfeld sichtbar)
  // — das belegt, dass Layout + Live-Stream (SSE) gemountet sind, BEVOR A absendet. Sonst
  // könnte A den Eintrag erfassen, während Bs EventSource noch nicht verbunden ist, und B
  // verpasst das Event (retries=0, kein Refetch-Fallback) → Flake.
  await anmelden(b);
  await b.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(b.getByPlaceholder('Inhalt …')).toBeVisible();

  // A erfasst einen Eintrag.
  const inhalt = `Live-Test ${Date.now()}`;
  await a.getByPlaceholder('Inhalt …').fill(inhalt);
  await a.getByRole('button', { name: 'Erfassen' }).click();

  // A sieht den Eintrag in der ETB-Tabelle. role=cell ist eindeutig gegenüber Tab
  // (role=tab) und Eingabefeld (role=textbox) — anders als ein generischer getByText,
  // der transient das live spiegelnde Entwurf-Tab-Label träfe.
  await expect(a.getByRole('cell', { name: inhalt })).toBeVisible();

  // B sieht den Eintrag ohne manuelles Neuladen (SSE-Live).
  await expect(b.getByRole('cell', { name: inhalt })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
