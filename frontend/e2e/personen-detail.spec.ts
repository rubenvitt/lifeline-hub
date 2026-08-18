import { expect, test, type Page } from '@playwright/test';

// e2e für LFH-19: Der Personen-Detail-Drawer wurde auf eine eigene Vollseiten-Route
// (`/einsaetze/:id/personen/:personId`) umgestellt. jsdom rechnet kein Layout, daher
// wird die Zwei-Spalten-Darstellung + Navigation hier real verifiziert.
//
// Harness: playwright.config.ts startet Backend UND Vite selbst (LFH-309) — auf freien
// Ports, gegen eine Temp-DB je Lauf, Login admin/e2e-admin-pw.

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
  // EinsaetzePage: Button heißt "Neuer Einsatz"; nach Anlegen navigiert die Seite
  // direkt zur Einsatz-Workspace (kein manuelles Öffnen nötig).
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  // Warten bis Navigation zum neuen Einsatz abgeschlossen ist.
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  // einsatzId aus der URL ziehen (`/einsaetze/<id>` oder `/einsaetze/<id>/<modul>`).
  const m = page.url().match(/\/einsaetze\/(\d+)/);
  if (!m) throw new Error(`einsatzId nicht in URL gefunden: ${page.url()}`);
  return Number(m[1]);
}

test('Personen: Liste navigiert zur Detail-Vollseite mit zwei Spalten', async ({ page }) => {
  await anmelden(page);
  const name = `E2E Personen ${Date.now()}`;
  const einsatzId = await einsatzAnlegenUndOeffnen(page, name);

  // Direkt ins Personen-Modul.
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await expect(page.getByRole('heading', { name: /Personen/ })).toBeVisible();

  // Person per Schnellerfassung anlegen (Modal: okText „Erfassen").
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Name UND Vorname liegen eingeklappt unter „Weitere Angaben": das Feldbudget (LFH-332 · B4)
  // hält vier sichtbare Felder, und seit LFH-340 · C5 belegt die Sichtungskategorie einen
  // davon — sichtbar sind Sichtung, Geschlecht, Alter und Antreffort. Der Zugangsname trägt
  // das Pfeil-Icon mit („collapsed Weitere Angaben"), deshalb ein Teiltreffer statt exact.
  await dialog.getByRole('button', { name: /Weitere Angaben/ }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Mustermann');
  await dialog.getByLabel('Vorname', { exact: true }).fill('Max');
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  // Erste Person bekommt Registriernummer R-001 und erscheint in der Liste.
  await expect(page.getByText('Mustermann, Max')).toBeVisible();

  // Klick auf die Zeile → Detail-Vollseite (kein Drawer mehr).
  await page.getByText('Mustermann, Max').click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/\\d+`));
  await expect(page.getByRole('heading', { name: /Person R-001/ })).toBeVisible();

  // Zwei-Spalten-Layout: Stammdaten UND med. Verlauf gleichzeitig sichtbar (keine Tabs).
  await expect(page.getByText('Stammdaten')).toBeVisible();
  await expect(page.getByText(/Chronologischer Verlauf/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Medizinischer Verlauf' })).toHaveCount(0);

  // Zurück zur Liste — über den Breadcrumb. Der eigene „Zurück zur Liste"-Knopf ist mit
  // LFH-340 · C5 entfallen: er stand als siebte gleichrangige Aktion neben dem Breadcrumb,
  // der denselben Weg trägt.
  await page.getByRole('link', { name: 'Personen', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Personen/ })).toBeVisible();
});
