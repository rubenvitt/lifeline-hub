import { expect, test, type Page, type Locator, type Response } from '@playwright/test';

/**
 * Das Befehls-Gedächtnis der Kommandopalette gegen den echten Server: die Vitest-Naht fährt
 * gegen MSW und belegt die Verdrahtung, aber nicht, dass der Stand einen NEULADEN überlebt.
 * Erst ein frisch geladener Client mit leerem Query-Cache belegt „pro Benutzer persistiert".
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FACH = '/api/benutzer-einstellungen';

function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

/** Die Gedächtnisgruppe der Startansicht — über ihre Überschrift, nicht über eine Position. */
function gedaechtnis(page: Page): Locator {
  return page.getByRole('group', { name: 'Zuletzt ausgeführt' });
}

/** Das Lesen des Präferenz-Fachs; `CommandPaletteProvider` stösst es app-weit beim Mount an. */
function standGeladen(page: Page): Promise<Response> {
  return page.waitForResponse((r) => r.url().includes(FACH) && r.request().method() === 'GET');
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function oeffnePalette(page: Page) {
  await expect(page.locator('header').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
}

test('merkt einen ausgeführten Befehl am Benutzer und zeigt ihn nach dem Neuladen zuoberst', async ({
  page,
}) => {
  const ersterStand = standGeladen(page);
  await anmelden(page);
  // Auf die Antwort warten statt sofort zu öffnen: `PaletteHost` friert den Stand beim Öffnen
  // ein, damit die oberste Gruppe nicht unter dem Cursor nachklappt (WCAG 3.2.5).
  await ersterStand;

  // Ausgangslage festhalten: die Temp-DB ist mit den übrigen Palette-Fällen geteilt, „die
  // Gruppe ist da" allein sagte nichts über DIESEN Befehl.
  await oeffnePalette(page);
  await expect(page.getByRole('option', { name: 'Profil', exact: true })).toBeVisible();
  await expect(gedaechtnis(page).getByRole('option', { name: 'Profil', exact: true })).toHaveCount(
    0,
  );

  // Die Palette schließt sich VOR der Ausführung — deshalb hängt der Schreibweg am Provider.
  const geschrieben = page.waitForResponse(
    (r) => r.url().includes(FACH) && r.request().method() === 'PUT',
  );
  await page.getByRole('option', { name: 'Profil', exact: true }).click();
  await expect(page).toHaveURL(/\/profil/);
  await expect(paletteInput(page)).toBeHidden();
  expect((await geschrieben).status()).toBe(200);

  // NEU LADEN: frischer Client, leerer Query-Cache. Was jetzt noch da ist, kam vom Server.
  const zweiterStand = standGeladen(page);
  await page.goto('/einsaetze');
  await zweiterStand;
  await oeffnePalette(page);

  await expect(
    gedaechtnis(page).getByRole('option', { name: 'Profil', exact: true }),
  ).toBeVisible();

  // ZUOBERST heißt: erste Gruppe im Kasten.
  await expect(page.getByRole('listbox').getByRole('group').first()).toHaveAttribute(
    'aria-label',
    'Zuletzt ausgeführt',
  );

  // Bei AKTIVER Suche entfällt die Gruppe — der Befehl steht dann genau einmal in der
  // Trefferliste.
  await paletteInput(page).fill('Profil');
  await expect(gedaechtnis(page)).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Profil', exact: true })).toHaveCount(1);
});
