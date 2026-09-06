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

// Regression LFH-457: Wer unmittelbar nach einer Belegung ein Platzmenü öffnete, verlor
// den Menü-Auslöser unter den Fingern. Ursache — gemessen, nicht vermutet — war NICHT ein
// Query-Refetch, der die Fläche neu rendert (ein Re-Render lässt ein offenes antd-Dropdown
// in Ruhe), sondern das ABHÄNGEN des Auslösers: `belegMut.isPending` fuhr als
// `schreibgeschuetzt` in die Platzkarte, und die rendert ihren Menü-Auslöser unter
// `{!schreibgeschuetzt && …}`. Während jeder Belegung waren damit ALLE Auslöser der Fläche
// aus dem Baum, und ein Portal-Overlay stirbt mit seinem Auslöser.
//
// GEMESSEN WIRD DIE URSACHE, NICHT IHRE FOLGE. Ein Test, der stattdessen klickt und auf
// den Menüeintrag wartet, hinge an einer zweiten, davon unabhängigen Schwäche: der erste
// Klick nach einem Drag öffnet das Dropdown unter Last nicht (dafür steht der
// Wiederhol-Block in `uhs-grundriss-person-scroll.spec.ts`, und dafür steht LFH-519). Er
// wäre damit flaky aus einem Grund, der mit diesem Befund nichts zu tun hat — und ein
// flakiger Test belegt nichts, auch wenn er meistens grün ist.
//
// Ein MutationObserver zählt die Auslöser über die GANZE Belegung: sie dürfen nie
// verschwinden. Die Belegungs-Antwort wird künstlich verzögert, damit das beobachtete
// Fenster breit ist statt der ~30 ms, die es im Normalbetrieb hat. Mutationsprobe gefahren:
// mit zurückgedrehter Prop fällt die Zahl auf 0 und der Test wird rot.
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

  // Die Belegung hängt künstlich — erst dadurch ist das beobachtete Fenster breit genug,
  // dass ein Ausfall nicht zwischen zwei Beobachtungen verschwindet.
  await page.route('**/uhs-belegung', async (route) => {
    await new Promise((fertig) => setTimeout(fertig, 1_500));
    await route.continue();
  });

  // Jede DOM-Änderung wird auf die Zahl der Auslöser hin geprüft; der Tiefstand wird
  // festgehalten. `attributes: true` gehört dazu — ein Auslöser könnte auch über eine
  // Klassen-/Attributänderung verschwinden, nicht nur durch Abhängen.
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

  // Das ENDE des Fensters wird an der Serverantwort festgemacht, nicht an der Anzeige.
  // Gemessen und hier festgehalten, weil es beim ersten Anlauf falsch war: sowohl „belegt"
  // (`Grundriss.tsx`, rein aus `belegtVon` abgeleitet — die Verfügbarkeit `belegt` gibt es
  // im Enum gar nicht) als auch der Personenname auf der Zielkarte stehen bereits durch das
  // OPTIMISTISCHE Update, also unmittelbar nach `mouse.up()`. Ein Test, der darauf wartet,
  // liest den Tiefstand am ANFANG der Pending-Phase und sähe eine Regression nicht, die den
  // Auslöser erst beim `onSettled`/Refetch abhängt — ausgerechnet die Hypothese, mit der
  // dieses Ticket startete. Die künstliche Verzögerung vergrößerte dann nur den
  // unbeobachteten Teil.
  const belegungDurch = page.waitForResponse(
    (a) => a.url().includes('/uhs-belegung') && a.request().method() === 'POST',
  );
  // Der nachlaufende Refetch gehört mit ins Fenster: `invalidate()` stößt ihn in
  // `onSettled` an, und die Mutation bleibt bis dahin `pending`.
  const nachladenDurch = page.waitForResponse((a) => /\/uhs\/\d+$/.test(new URL(a.url()).pathname));

  await ziehe(page, page.getByText(personName).first(), page.getByText('Behandlungsplatz 1'));

  await belegungDurch;
  await nachladenDurch;
  await expect(page.getByText('belegt')).toBeVisible();

  const { tief, proben } = await page.evaluate(() => ({
    tief: (window as unknown as { __tief: number }).__tief,
    proben: (window as unknown as { __proben: number }).__proben,
  }));
  // Der Beobachter hat wirklich gearbeitet — ohne diese Zeile wäre ein Tiefstand von 2 auch
  // dann zu haben, wenn gar nichts beobachtet wurde.
  expect(proben).toBeGreaterThan(1);
  expect(tief).toBe(2);
});
