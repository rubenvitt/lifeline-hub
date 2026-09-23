import { expect, test, type Page } from '@playwright/test';

/**
 * Das Kennzahlenband und die drei Paneele des Lage-Dashboards auf den drei Prüfbreiten
 * (LFH-329 · B1, neu gedacht mit dem Neuentwurf S3).
 *
 * WARUM HIER UND NICHT IN VITEST: `vite.config.ts` fährt Vitest mit `css: false`, und jsdom
 * rechnet kein Layout — `gridTemplateColumns` bliebe leer und `scrollWidth` konstant 0. Dass
 * das Band UMBRICHT statt zu scrollen, ist ausschließlich hier messbar.
 *
 * DIE STAFFEL HÄNGT SEIT DEM NEUENTWURF AM VIEWPORT, NICHT AM CONTAINER. Die A0-Seite trug
 * eine Container-Staffel in `sprache.css` (`.lfh-flaeche`, 1100/700 px Containerbreite); das
 * Band ist jetzt der Baustein `Kennzahlenband` mit fester Spaltenzahl, die die Seite über
 * `useViewport` wählt: ab `xl` (1200) sechs, ab `md` (768) drei, darunter zwei. Die Paneele
 * stehen ab `lg` (992) nebeneinander, darunter gestapelt. Gemessen wird trotzdem die Breite
 * der Fläche (`[data-lfh="lagebild"]`) und als Anmerkung protokolliert, damit eine spätere
 * Schwellenverschiebung nachgerechnet und nicht geraten wird.
 *
 * Bewusst KEIN zweites Playwright-Projekt und kein Device-Descriptor: ein
 * `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo nirgends
 * abgesichert. Die Breite kommt per `setViewportSize` im bestehenden chromium-Projekt.
 *
 * NICHT geprüft: `document.body.scrollWidth` auf Dokumentebene. Diese Spec misst die Fläche
 * des Dashboards — der dokumentweite Überlauf hängt am Navigationsrahmen und wird in
 * `nav-schmal.spec.ts` belegt.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

// Login-/Anlege-Helfer aus `seitenrinne.spec.ts` kopiert — es gibt (noch) kein
// geteiltes e2e-Hilfsmodul.
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/** Einmal angelegt, von allen Tests der Datei weiterbenutzt — drei Einsätze für
 *  dieselbe Vorbedingung wären reine Gate-Laufzeit. */
let einsatzId: string | null = null;

const BAND = (page: Page) => page.getByRole('group', { name: 'Lage in Zahlen' });
const FLAECHE = (page: Page) => page.locator('[data-lfh="lagebild"]');
const PANEELE = (page: Page) => page.locator('[data-lfh="lagebild-paneele"]');

/**
 * Meldet an, stellt die Prüfbreite ein und öffnet das Dashboard.
 *
 * Anmeldung und Anlegen laufen im Default-Viewport (1280 × 720): auf 390 px liegt
 * „Neuer Einsatz" hinter dem Kopfgriff, und das Setup bräche an einer Stelle, die dieser
 * Test gar nicht prüft.
 */
async function dashboardOeffnen(page: Page, breite: number, hoehe: number) {
  await anmelden(page);
  einsatzId ??= await einsatzAnlegen(page, `E2E Kennzahlen ${Date.now()}`);

  await page.setViewportSize({ width: breite, height: hoehe });
  await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
  // Anker: die geladenen Zellen sind LINKS — die Platzhalter vor dem Einsatz-Abruf nicht.
  await expect(BAND(page).locator('a[data-lfh="kennzahl"]')).toHaveCount(6);
}

/** Spaltenzahl von Band und Paneelraster + Flächenbreite, als Anmerkung protokolliert. */
async function messen(page: Page, viewportBreite: number) {
  // Beweist, dass die Selektoren genau einen Knoten treffen — sonst wäre eine grüne
  // Zusicherung grün durch Nichtstun.
  await expect(FLAECHE(page)).toHaveCount(1);
  await expect(BAND(page)).toHaveCount(1);
  await expect(PANEELE(page)).toHaveCount(1);

  const band = await BAND(page).evaluate((el) => ({
    spalten: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  const paneelSpalten = await PANEELE(page).evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
  );
  const flaecheBreite = await FLAECHE(page).evaluate((el) => el.clientWidth);

  test.info().annotations.push({
    type: 'gemessen',
    description:
      `Viewport ${viewportBreite} px → Fläche ${flaecheBreite} px ` +
      `→ Band ${band.spalten} Spalten (${band.scrollWidth}/${band.clientWidth} px), ` +
      `Paneele ${paneelSpalten} Spalten, ` +
      // Die Einsatz-Nummer steht mit in der Anmerkung, damit belegt ist, dass alle drei
      // Tests DIESELBE Vorbedingung teilen.
      `Einsatz ${einsatzId}`,
  });

  return { ...band, paneelSpalten, flaecheBreite };
}

async function keinWaagerechterUeberlauf(page: Page) {
  for (const [name, ort] of [
    ['Band', BAND(page)],
    ['Fläche', FLAECHE(page)],
    ['Paneele', PANEELE(page)],
  ] as const) {
    const mass = await ort.evaluate((el) => ({ scroll: el.scrollWidth, klient: el.clientWidth }));
    expect(mass.scroll, `${name}: Inhalt breiter als die Fläche`).toBeLessThanOrEqual(
      mass.klient + 1,
    );
  }
}

/**
 * Jede Kennzahl steht vollständig in ihrer eigenen Zelle.
 *
 * Das ist die schärfere Prüfung: das Band ist ein Raster aus `minmax(0, 1fr)` — es bekommt
 * NIE eine waagerechte Bildlaufleiste, auch wenn die Spalten viel zu schmal werden. Zu
 * schmale Spalten zeigen sich erst hier, weil dann der Wert (Mono 32) oder ein nicht
 * umbrechbares Stück der Notiz über seine Zelle hinausläuft.
 */
async function jedeKennzahlStehtInIhrerZelle(page: Page) {
  const masse = await BAND(page).evaluate((el) =>
    Array.from(el.querySelectorAll('[data-lfh="kennzahl"]')).map((k) => ({
      scroll: k.scrollWidth,
      klient: k.clientWidth,
    })),
  );
  // Immer sechs Plätze, gleich welche Lagekennzahlen der Einsatz trägt (LFH-640).
  expect(masse).toHaveLength(6);
  for (const [i, mass] of masse.entries()) {
    expect(mass.scroll, `Kennzahl ${i + 1}: Inhalt läuft aus der Zelle`).toBeLessThanOrEqual(
      mass.klient + 1,
    );
    expect(mass.klient, `Kennzahl ${i + 1} ohne Breite`).toBeGreaterThan(0);
  }
}

// Bewusst KEIN `.serial`: die drei Tests sind unabhängig (jeder meldet sich selbst an), und
// im Reihen-Modus verdeckte ein Fehlschlag am Fükw-Schirm die Messwerte der übrigen zwei
// Breiten — also genau die Zahlen, die man zur Diagnose braucht.
test.describe('Lage-Dashboard auf den drei Prüfbreiten', () => {
  test('am Fükw-Schirm (1366 px) sechs Kennzahlen in einer Reihe, drei Paneele nebeneinander', async ({
    page,
  }) => {
    // Der primäre Einsatzkontext (Fükw, 13–15"). 1366 ≥ `xl` → sechs Spalten wie im
    // Entwurf; ≥ `lg` → Gefahrenmatrix, Sichtung und Meldungsstrom nebeneinander.
    await dashboardOeffnen(page, 1366, 768);
    const mass = await messen(page, 1366);
    expect(mass.spalten, 'Band-Spalten am Fükw-Schirm').toBe(6);
    expect(mass.paneelSpalten, 'Paneele am Fükw-Schirm').toBe(3);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhrerZelle(page);
  });

  test('bei 1024 px drei Spalten im Band, die Paneele noch nebeneinander', async ({ page }) => {
    // Führungs-Tablet. 1024 liegt zwischen `lg` (992) und `xl` (1200): das Band steht in
    // 3 × 2, die Paneele bleiben dreispaltig. Die Überlaufprüfungen sind hier die
    // eigentliche Aussage — drei Paneele auf der verbleibenden Fläche sind der Engpass.
    await dashboardOeffnen(page, 1024, 768);
    const mass = await messen(page, 1024);
    expect(mass.spalten, 'Band-Spalten am Führungs-Tablet').toBe(3);
    expect(mass.paneelSpalten, 'Paneele am Führungs-Tablet').toBe(3);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhrerZelle(page);
  });

  test('bei 390 px zwei Spalten im Band, Paneele gestapelt, kein waagerechter Bildlauf', async ({
    page,
  }) => {
    // Handschirm, einhändig. 6 Kennzahlen / 2 Spalten = 3 Zeilen; die Paneele stapeln unter
    // `lg`. ZWEI verschiedene Aussagen an derselben Messung: „kein Überlauf" (die Fläche)
    // und „jede Kennzahl in ihrer Zelle" (die Spalten) — eine zu breite Mindestspalte fiele
    // nur bei der ersten auf, eine zu schmale nur bei der zweiten.
    await dashboardOeffnen(page, 390, 844);
    const mass = await messen(page, 390);
    expect(mass.spalten, 'Band-Spalten am Handschirm').toBe(2);
    expect(mass.paneelSpalten, 'Paneele am Handschirm').toBe(1);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhrerZelle(page);
  });
});
