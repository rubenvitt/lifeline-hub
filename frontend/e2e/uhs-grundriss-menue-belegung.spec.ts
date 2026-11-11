import { expect, test, type Page, type Locator } from '@playwright/test';
import { einsatzDialogOeffnen } from './einsatz-kern';

// Gezogen wird zwischen Liste und Platz: das verlangt die Drei-Spalten-Form, und die steht erst,
// wenn die Fläche neben beiden Seitenspalten ganz in den Rahmen passt (`dreiSpaltenPassen` in
// `pages/uhs/grundrissLayout.ts`). Bei 1280 px neben Rail und Modulpanel steht die Reiterform.
// Die Höhe bleibt die des Standardfensters.
test.use({ viewport: { width: 1920, height: 720 } });

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

/** Einsatz mit einer Person unter „Noch nicht aufgenommen" und einer aktiven UHS mit zwei
 *  Behandlungsplätzen. Liefert den Personennamen. */
async function grundrissMitZweiPlaetzen(page: Page): Promise<string> {
  await anmelden(page);
  const einsatzName = `E2E UHS Menue ${Date.now()}`;
  await einsatzDialogOeffnen(page);
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Betroffene erfassen' }).click();
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
  await page.getByRole('button', { name: uhsName, exact: true }).click();

  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  await page.getByRole('combobox', { name: 'Platz-Typ' }).click({ force: true });
  await page.getByText('Behandlungsplatz', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Menge' }).fill('2');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Behandlungsplatz 2')).toBeVisible();

  await page.getByRole('button', { name: 'In Betrieb nehmen' }).click();
  await expect(page.getByRole('button', { name: 'Plätze bearbeiten' })).toBeVisible();
  await expect(page.locator('button[aria-label^="Platzaktionen"]')).toHaveCount(2);
  return personName;
}

// Die Platzmenü-Auslöser bleiben während einer laufenden Belegung im Baum: ein
// Portal-Overlay stirbt mit seinem Auslöser, und `belegMut.isPending` darf nicht als
// `schreibgeschuetzt` in die Platzkarte fahren (LFH-457).
//
// GEMESSEN WIRD DIE URSACHE, NICHT DIE FOLGE: ein Test, der klickt und auf den Menüeintrag
// wartet, sähe nur den einen Zeitpunkt seines Klicks. Ein MutationObserver zählt die Auslöser
// über die GANZE Belegung; die Antwort wird künstlich verzögert, damit das beobachtete Fenster
// breit ist.
test('UHS Grundriss: die Platzmenü-Auslöser überleben eine laufende Belegung', async ({ page }) => {
  const personName = await grundrissMitZweiPlaetzen(page);

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
  await expect(page.getByText('belegt', { exact: true })).toBeVisible();

  const { tief, proben } = await page.evaluate(() => ({
    tief: (window as unknown as { __tief: number }).__tief,
    proben: (window as unknown as { __proben: number }).__proben,
  }));
  // Der Beobachter hat wirklich gearbeitet — sonst wäre ein Tiefstand von 2 auch ohne
  // Beobachtung zu haben.
  expect(proben).toBeGreaterThan(1);
  expect(tief).toBe(2);
});

/** Drop-Target zu einem Spalten-Titel: der Paneel-Körper (zweites Kind), nicht der Kopf —
 *  dort sitzt das Droppable. */
function dropZone(page: Page, titel: string): Locator {
  return page.locator('[data-lfh="paneel"]', { hasText: titel }).locator(':scope > div').nth(1);
}

// Der erste Klick nach einem Drag öffnet das Platzmenü, und die Wahl wirkt (LFH-519). dnd-kit schluckte bis zu
// seinem 50-ms-Timer JEDEN Klick; unter Last verhungert der Timer, und der nächste echte Klick
// ging verloren. Hier fällt der Klick ohne Aktionsprüfung sofort nach dem Loslassen — in genau
// dieses Fenster (mit dem nackten `PointerSensor` gemessen rot, 3 von 3). Die Koordinaten stehen
// vor dem Zug fest, damit zwischen Loslassen und Klick kein Rundlauf liegt.
//
// Vorab gemessene Koordinaten verlangen, dass der Zug nichts über dem Grundriss verschiebt
// (LLH-1624). Kam die Person aus „Noch nicht aufgenommen", wurde aus „Auflösen" im Seitenkopf
// „Auflösen (noch 1 Person)"; war der Kopf knapp, brach er um, der Grundriss rutschte ~35 px, und
// der Klick traf das „frei"-Tag statt „…". Darum steht die Person vor dem Messen schon im
// Wartebereich derselben UHS: der Zug von dort auf den Platz lässt den Kopf, wie er ist. Den
// Sprung selbst behebt LLH-1627 (Test unten); der Weg über den Wartebereich bleibt, weil dieser
// Test den Klick nach dem Zug prüft, nicht den Kopf.
test('UHS Grundriss: der erste Klick nach einem Drag öffnet das Platzmenü', async ({ page }) => {
  const personName = await grundrissMitZweiPlaetzen(page);
  const wartebereich = dropZone(page, 'Wartebereich (Eingang)');
  await ziehe(page, page.getByText(personName).first(), wartebereich);
  await expect(wartebereich.getByText(personName)).toBeVisible();
  // Serverstand, nicht der optimistische: erst mit der Personenliste steht der Kopf endgültig.
  await expect(page.getByRole('button', { name: 'Auflösen (noch 1 Person)' })).toBeVisible();
  const marke = page
    .locator('[aria-roledescription="draggable"]')
    .filter({ has: page.locator('[data-lfh="personenkarte"]', { hasText: personName }) });
  await expect(marke).toHaveAttribute('aria-disabled', 'false');

  const karte = page.locator('[data-testid="platz-karte"]', { hasText: 'Behandlungsplatz 2' });
  const ausloeser = karte.locator('button[aria-label^="Platzaktionen"]');
  const k = (await ausloeser.boundingBox())!;

  await ziehe(page, wartebereich.getByText(personName), page.getByText('Behandlungsplatz 1'));
  await page.mouse.click(k.x + k.width / 2, k.y + k.height / 2);

  // Erst nach dem Klick, also ohne Rundlauf davor: Stand der Auslöser noch dort, wo geklickt
  // wurde? Sonst nennt der Fehler den Versatz statt eines fehlenden Menüs.
  const nachher = (await ausloeser.boundingBox())!;
  expect(
    { x: Math.round(nachher.x), y: Math.round(nachher.y) },
    'Auslöser hat sich durch den Zug verschoben — der Klick ging daneben',
  ).toEqual({ x: Math.round(k.x), y: Math.round(k.y) });

  await page.getByRole('menuitem', { name: 'als in Aufbereitung markieren' }).click();
  await expect(karte.getByText('aufbereitung')).toBeVisible();
});

// Ablegen des ersten Patienten lässt den Grundriss stehen, auch wenn der Seitenkopf auf der
// Kippe steht (LLH-1627). Aus „Auflösen“ wird „Auflösen (noch 1 Person)“; der Knopf hält die
// Breite dieser Form schon vorher (`components/BreiteHalten.tsx`). Ohne das wuchs er beim Ablegen,
// die Aktionen brachen in eine zweite Zeile, und alles darunter rückte ~35 px.
//
// Die Kippe ist gebaut, nicht vom Zufall der Namenslängen abhängig: der Titelblock bekommt genau
// den Platz neben den Aktionen, bis auf 1 px. Jeder Zuwachs der Aktionen bräche dann um.
test('UHS Grundriss: Ablegen aus „Noch nicht aufgenommen“ verschiebt den Grundriss nicht', async ({
  page,
}) => {
  const personName = await grundrissMitZweiPlaetzen(page);
  // Serverstand: die Personenliste ist da, niemand belegt, der Kopf steht endgültig.
  await expect(page.getByRole('button', { name: 'Auflösen', exact: true })).toBeEnabled();

  const kopf = page.locator('[data-lfh="seitenkopf"]');
  await kopf.evaluate((el) => {
    const titel = el.querySelector<HTMLElement>('.lfh-seitenkopf__titelblock')!;
    const aktionen = el.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    const stil = getComputedStyle(el);
    const innen = el.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight);
    const platz = innen - parseFloat(stil.columnGap) - aktionen.getBoundingClientRect().width - 1;
    titel.style.flex = `0 0 ${Math.floor(platz)}px`;
  });
  const vorher = (await kopf.boundingBox())!;
  const karte = page.locator('[data-testid="platz-karte"]', { hasText: 'Behandlungsplatz 2' });
  const k = (await karte.boundingBox())!;
  // Aktionen und Titelblock stehen in EINER Zeile: sonst prüfte der Test die Kippe nicht.
  const aktionenBox = (await page.locator('[data-lfh="seitenkopf-aktionen"]').boundingBox())!;
  const titelBox = (await kopf.locator('.lfh-seitenkopf__titelblock').boundingBox())!;
  expect(aktionenBox.y, 'Aktionen stehen schon vor dem Zug in einer zweiten Zeile').toBeLessThan(
    titelBox.y + titelBox.height,
  );

  await ziehe(page, page.getByText(personName).first(), page.getByText('Behandlungsplatz 1'));
  // Serverstand nach dem Ablegen: erst mit der neuen Personenliste wechselt der Wortlaut.
  await expect(page.getByRole('button', { name: 'Auflösen (noch 1 Person)' })).toBeDisabled();

  const nachher = (await kopf.boundingBox())!;
  expect(Math.round(nachher.height), 'Seitenkopf ist beim Ablegen gewachsen').toBe(
    Math.round(vorher.height),
  );
  const kn = (await karte.boundingBox())!;
  expect(
    { x: Math.round(kn.x), y: Math.round(kn.y) },
    'Grundriss hat sich durch das Ablegen verschoben',
  ).toEqual({ x: Math.round(k.x), y: Math.round(k.y) });
});
