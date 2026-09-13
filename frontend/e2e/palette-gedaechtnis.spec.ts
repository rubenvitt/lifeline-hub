import { expect, test, type Page, type Locator, type Response } from '@playwright/test';

/**
 * Das Befehls-Gedächtnis der Kommandopalette (LFH-391 · Etappe D) gegen den ECHTEN Server.
 *
 * Was jsdom nicht beantworten kann, und genau deshalb steht dieser Fall hier: die
 * Vitest-Naht (`CommandPaletteProvider.gedaechtnis.test.tsx`) fährt gegen MSW und beweist
 * die Verdrahtung — nicht aber, dass der Stand einen NEULADEN überlebt. Das wörtliche
 * Akzeptanzkriterium lautet „pro Benutzer persistiert"; erst ein frisch geladener Client mit
 * leerem Query-Cache, der den Eintrag vom Server zurückbekommt, belegt es.
 *
 * Harness wie `command-palette.spec.ts`: Backend und Vite startet playwright.config.ts
 * selbst, Login gegen eine Temp-DB je Lauf.
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
  // AUF DIE ANTWORT WARTEN, statt sofort zu öffnen — und das ist keine Test-Bequemlichkeit,
  // sondern die gemessene Kehrseite des Standbilds: `PaletteHost` friert den Stand beim
  // Öffnen ein, damit die oberste Gruppe nicht unter dem Cursor nachklappt (WCAG 3.2.5).
  // Wer die Palette schneller öffnet, als der erste Abruf zurückkommt, sieht das Gedächtnis
  // erst beim nächsten Öffnen. Im Betrieb liegen dazwischen Sekunden, im Test Millisekunden.
  await ersterStand;

  // Ausgangslage festhalten: der e2e-Benutzer teilt sich die Temp-DB mit den übrigen
  // Palette-Fällen, „die Gruppe ist da" allein wäre also keine Aussage über DIESEN Befehl.
  await oeffnePalette(page);
  await expect(page.getByRole('option', { name: 'Profil', exact: true })).toBeVisible();
  await expect(gedaechtnis(page).getByRole('option', { name: 'Profil', exact: true })).toHaveCount(
    0,
  );

  // Ausführen — die Palette schliesst sich dabei selbst, VOR der Ausführung. Genau deshalb
  // hängt der Schreibweg am Provider und nicht an ihr.
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

  // ZUOBERST heisst: erste Gruppe im Kasten. Die Startansicht ist kuratiert (LFH-337 · M11),
  // und das Gedächtnis ist der Grund, aus dem sie diese Reihenfolge hat.
  await expect(page.getByRole('listbox').getByRole('group').first()).toHaveAttribute(
    'aria-label',
    'Zuletzt ausgeführt',
  );

  // Bei AKTIVER Suche entfällt die Gruppe — der Befehl steht dann genau einmal in der
  // flachen Trefferliste, nicht zweimal mit gleichem Label und gleichem Ziel.
  await paletteInput(page).fill('Profil');
  await expect(gedaechtnis(page)).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Profil', exact: true })).toHaveCount(1);
});
