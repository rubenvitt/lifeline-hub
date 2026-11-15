import { expect, test } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { anmeldenPerApi } from './anmelde-kern';
import { einsatzPerApi } from './einsatz-kern';

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
  await anmeldenPerApi(page, ADMIN, PW);

  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Hilfe' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hilfe' })).toBeVisible();

  await waehleIn(page.getByRole('combobox', { name: 'Lesergruppe' }), 'Administration');
  await expect(page).toHaveURL(/\/hilfe\?gruppe=administration$/);
  const navi = page.getByRole('navigation', { name: 'Kapitel' });
  await expect(navi.getByText('Gerät verloren')).toBeVisible();
  await expect(navi.getByText('Arbeiten ohne Netz')).toHaveCount(0);

  // Ohne offenen Einsatz in dieser Sitzung: zur Einsatzliste (LLH-1731).
  await page.getByRole('button', { name: 'Zu den Einsätzen' }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
});

test('aus dem Einsatz am breiten Schirm: Hilfe im neuen Tab, Rückweg an die Stelle (LLH-1731)', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, PW);
  const name = `Hilfe neben dem Einsatz ${Date.now()}`;
  const einsatzId = await einsatzPerApi(page, name);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByRole('region', { name: 'Einsatztagebuch' })).toBeVisible();

  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  const [hilfe] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('menuitem', { name: 'Hilfe' }).click(),
  ]);
  await expect(hilfe.getByRole('heading', { level: 1, name: 'Hilfe' })).toBeVisible();
  // Die Herkunft ist in den Verlauf gewandert, die Adresse trägt sie nicht mehr.
  await expect(hilfe).toHaveURL(/\/hilfe$/);
  // Der Einsatz bleibt im ersten Tab.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb$`));

  await hilfe.getByRole('button', { name: `Zurück zu ${name}` }).click();
  await expect(hilfe).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb$`));
});

test('am Handy: ein langer Einsatzname im Rückweg sprengt die Hilfe nicht quer (LLH-1731)', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, PW);
  const name = `Unwetter mit Starkregen und Überflutung im gesamten Kreisgebiet Süd ${Date.now()}`;
  const einsatzId = await einsatzPerApi(page, name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByRole('region', { name: 'Einsatztagebuch' })).toBeVisible();

  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Hilfe' }).click();
  const zurueck = page.getByRole('button', { name: `Zurück zu ${name}` });
  await expect(zurueck).toBeVisible();
  // Gekürzt statt quer: die Seite rollt nicht waagerecht, der volle Name steht im `title`.
  const breiten = await page.evaluate(() => ({
    inhalt: document.documentElement.scrollWidth,
    fenster: window.innerWidth,
  }));
  expect(breiten.inhalt).toBeLessThanOrEqual(breiten.fenster);
  await expect(zurueck).toHaveAttribute('title', `Zurück zu ${name}`);
  await zurueck.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb$`));
});
