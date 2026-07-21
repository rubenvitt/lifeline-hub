import { expect, test, type Page } from '@playwright/test';

// Fokussierter e2e für LFH-142 (ETB-Entwurf-Tabs + Autosave). Umgeht bewusst die
// Einsatz-Modul-Navigation (die kernfluss.spec.ts derzeit stale macht), indem nach
// dem Anlegen direkt die ETB-Modul-URL angesteuert wird.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegenUndOeffnen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  // App navigiert nach dem Anlegen automatisch in den Einsatz (Default-Modul).
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const m = page.url().match(/\/einsaetze\/(\d+)/);
  const id = m![1];
  await page.goto(`/einsaetze/${id}/etb`);
  return id;
}

test('ETB-Entwurf-Tab: Eintrag erfassen landet in der Tabelle, Entwurf-Tab wird wieder leer', async ({
  page,
}) => {
  await anmelden(page);
  const name = `E2E ETB ${Date.now()}`;
  await einsatzAnlegenUndOeffnen(page, name);

  // Beim Öffnen ist ein leerer Entwurf-Tab aktiv (Erfassungsfeld + Erfassen-Button da).
  const feld = page.getByPlaceholder('Inhalt …');
  await expect(feld).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erfassen' })).toBeVisible();

  // Eintrag erfassen. Während des Tippens spiegelt das Tab-Label den Inhalt (Autosave);
  // nach dem Absenden schließt der Tab und ein neuer leerer Tab ('Neuer Eintrag') wird aktiv.
  const inhalt = `Lagemeldung ${Date.now()}`;
  await feld.fill(inhalt);
  await page.getByRole('button', { name: 'Erfassen' }).click();

  // Erst den stabilen Zustand nach dem Absenden abwarten: das Eingabefeld ist geleert
  // und der Tab auf einen neuen leeren Entwurf zurückgesetzt. (Während des Tippens
  // spiegelt das Tab-Label den Inhalt — ein zu generischer getByText(inhalt) träfe
  // darum transient sowohl Tab-Label als auch textarea.)
  await expect(page.getByPlaceholder('Inhalt …')).toHaveValue('');

  // Der erfasste Eintrag steht in der ETB-Tabelle. Eine Tabellen-Zelle (role=cell) ist
  // eindeutig gegenüber Tab (role=tab) und Eingabefeld (role=textbox).
  await expect(page.getByRole('cell', { name: inhalt })).toBeVisible();
});

test('ETB-Entwurf-Autosave: getippter Entwurf überlebt einen Reload', async ({ page }) => {
  await anmelden(page);
  const name = `E2E Autosave ${Date.now()}`;
  await einsatzAnlegenUndOeffnen(page, name);

  const entwurf = `Angefangen, nicht gesendet ${Date.now()}`;
  await page.getByPlaceholder('Inhalt …').fill(entwurf);

  // Reload: der lokal (IndexedDB) gesicherte Entwurf muss im Eingabefeld erhalten bleiben.
  await page.reload();
  await expect(page.getByPlaceholder('Inhalt …')).toHaveValue(entwurf);
});
