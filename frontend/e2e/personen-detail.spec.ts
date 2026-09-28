import { expect, test, type Page } from '@playwright/test';

// Die Personen-Detailseite als Vollseiten-Route: Zwei-Spalten-Darstellung und Navigation
// (jsdom rechnet kein Layout).

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegenUndOeffnen(page: Page, name: string): Promise<number> {
  // Nach dem Anlegen navigiert die Seite direkt in den Einsatz-Workspace.
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  // einsatzId aus der URL (`/einsaetze/<id>` oder `/einsaetze/<id>/<modul>`).
  const m = page.url().match(/\/einsaetze\/(\d+)/);
  if (!m) throw new Error(`einsatzId nicht in URL gefunden: ${page.url()}`);
  return Number(m[1]);
}

test('Personen: Liste navigiert zur Detail-Vollseite mit zwei Spalten', async ({ page }) => {
  await anmelden(page);
  const name = `E2E Personen ${Date.now()}`;
  const einsatzId = await einsatzAnlegenUndOeffnen(page, name);

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  // Der Seitentitel heißt „Betroffene"; die Route bleibt `personen`.
  await expect(page.getByRole('heading', { name: 'Betroffene', exact: true })).toBeVisible();

  // Person per Schnellerfassung anlegen (Modal: okText „Erfassen").
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Name und Vorname liegen unter „Weitere Angaben" (Feldbudget: sichtbar sind Sichtung,
  // Geschlecht, Alter, Antreffort). Teiltreffer, weil ältere antd-Fassungen das Pfeil-Icon im
  // Zugangsnamen trugen.
  await dialog.getByRole('button', { name: /Weitere Angaben/ }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Mustermann');
  await dialog.getByLabel('Vorname', { exact: true }).fill('Max');
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  // Erste Person bekommt Registriernummer R-001 und erscheint in der Liste.
  await expect(page.getByText('Mustermann, Max')).toBeVisible();

  // Klick auf die Zeile → Detail-Vollseite.
  await page.getByText('Mustermann, Max').click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/\\d+`));
  await expect(page.getByRole('heading', { name: /Person R-001/ })).toBeVisible();

  // Zwei-Spalten-Layout: Stammdaten UND med. Verlauf gleichzeitig sichtbar (keine Tabs).
  await expect(page.getByText('Stammdaten')).toBeVisible();
  await expect(page.getByText(/Chronologischer Verlauf/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Medizinischer Verlauf' })).toHaveCount(0);

  // Zurück zur Liste über den Breadcrumb.
  await page.getByRole('link', { name: 'Personen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Betroffene', exact: true })).toBeVisible();
});
