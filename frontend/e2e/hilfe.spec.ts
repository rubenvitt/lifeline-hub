import { expect, test } from '@playwright/test';
import { waehleIn } from './auswahl-kern';

/**
 * Hilfe (LFH-1096, Spec `anwenderdoku`): erreichbar vor der Anmeldung und aus dem Benutzermenü,
 * Rückweg nach Sitzung. Offline und Druck belegen `hilfe-offline-precache.spec.ts` und
 * `hilfe-druck.spec.ts`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test('vor der Anmeldung: Hilfe zum Anmelden, zurück zur Anmeldung', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Hilfe' }).click();
  await expect(page).toHaveURL(/\/hilfe\/anmelden-abmelden$/);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Anmelden und Abmelden' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Zur Anmeldung' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('angemeldet: Hilfe aus dem Benutzermenü, Gruppe wählen, zurück in die App', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);

  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Hilfe' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hilfe' })).toBeVisible();

  await waehleIn(page.getByRole('combobox', { name: 'Lesergruppe' }), 'Administration');
  await expect(page).toHaveURL(/\/hilfe\?gruppe=administration$/);
  const navi = page.getByRole('navigation', { name: 'Kapitel' });
  await expect(navi.getByText('Gerät verloren')).toBeVisible();
  await expect(navi.getByText('Arbeiten ohne Netz')).toHaveCount(0);

  await page.getByRole('button', { name: 'Zur App' }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
});
