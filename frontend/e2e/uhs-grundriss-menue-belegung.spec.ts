import { expect, test, type Page, type Locator } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Mausgesten-Helfer: zieht das Zentrum von `quelle` auf das Zentrum von `ziel`. */
async function ziehe(page: Page, quelle: Locator, ziel: Locator) {
  const a = await quelle.boundingBox();
  const b = await ziel.boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 16 });
  await page.mouse.up();
}

// Die Platzmenü-Auslöser bleiben während einer laufenden Belegung im Baum: ein
// Portal-Overlay stirbt mit seinem Auslöser, und `belegMut.isPending` darf nicht als
// `schreibgeschuetzt` in die Platzkarte fahren (LFH-457).
//
// GEMESSEN WIRD DIE URSACHE, NICHT DIE FOLGE: ein Test, der klickt und auf den Menüeintrag
// wartet, hinge an einer unabhängigen Schwäche (der erste Klick nach einem Drag öffnet das
// Dropdown unter Last manchmal nicht, LFH-519) und wäre flaky. Ein MutationObserver zählt die
// Auslöser über die GANZE Belegung; die Antwort wird künstlich verzögert, damit das
// beobachtete Fenster breit ist.
test('UHS Grundriss: die Platzmenü-Auslöser überleben eine laufende Belegung', async ({ page }) => {
  await anmelden(page);
  const einsatzName = `E2E UHS Menue ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const personName = `MenuePat${Date.now()}`;
  await page.getByRole('button', { name: /Weitere Angaben/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(personName);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.getByText(personName).first()).toBeVisible();

  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  const uhsName = `BHP Menue ${Date.now()}`;
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.getByRole('button', { name: uhsName }).click();

  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  await page.getByRole('combobox', { name: 'Platz-Typ' }).click({ force: true });
  await page.getByText('Behandlungsplatz', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Menge' }).fill('2');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Behandlungsplatz 2')).toBeVisible();

  await page.getByRole('button', { name: 'In Betrieb nehmen' }).click();
  await expect(page.getByRole('button', { name: 'Plätze bearbeiten' })).toBeVisible();
  await expect(page.locator('button[aria-label^="Platzaktionen"]')).toHaveCount(2);

  // Die Belegung hängt künstlich — erst dadurch ist das Fenster breit genug.
  await page.route('**/uhs-belegung', async (route) => {
    await new Promise((fertig) => setTimeout(fertig, 1_500));
    await route.continue();
  });

  // Jede DOM-Änderung wird auf die Zahl der Auslöser geprüft, der Tiefstand festgehalten.
  // `attributes: true`, weil ein Auslöser auch über eine Attributänderung verschwinden könnte.
  await page.evaluate(() => {
    const w = window as unknown as { __tief: number; __proben: number };
    const zaehle = () => document.querySelectorAll('button[aria-label^="Platzaktionen"]').length;
    w.__tief = zaehle();
    w.__proben = 1;
    new MutationObserver(() => {
      w.__tief = Math.min(w.__tief, zaehle());
      w.__proben += 1;
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });

  // Das ENDE des Fensters hängt an der Serverantwort, nicht an der Anzeige: „belegt" und der
  // Name auf der Zielkarte stehen schon durch das OPTIMISTISCHE Update — darauf zu warten
  // verpasste eine Regression, die den Auslöser erst in `onSettled`/Refetch abhängt.
  const belegungDurch = page.waitForResponse(
    (a) => a.url().includes('/uhs-belegung') && a.request().method() === 'POST',
  );
  // Der nachlaufende Refetch gehört mit ins Fenster: die Mutation bleibt bis dahin `pending`.
  const nachladenDurch = page.waitForResponse((a) => /\/uhs\/\d+$/.test(new URL(a.url()).pathname));

  await ziehe(page, page.getByText(personName).first(), page.getByText('Behandlungsplatz 1'));

  await belegungDurch;
  await nachladenDurch;
  await expect(page.getByText('belegt')).toBeVisible();

  const { tief, proben } = await page.evaluate(() => ({
    tief: (window as unknown as { __tief: number }).__tief,
    proben: (window as unknown as { __proben: number }).__proben,
  }));
  // Der Beobachter hat wirklich gearbeitet — sonst wäre ein Tiefstand von 2 auch ohne
  // Beobachtung zu haben.
  expect(proben).toBeGreaterThan(1);
  expect(tief).toBe(2);
});
