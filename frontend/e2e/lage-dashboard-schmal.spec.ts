import { expect, test, type Page } from '@playwright/test';

/**
 * Kennzahlenband und die drei Paneele des Lage-Dashboards auf den drei Prüfbreiten. Dass das
 * Band UMBRICHT statt zu scrollen, ist nur im Browser messbar.
 *
 * DIE STAFFEL HÄNGT AM VIEWPORT: `Kennzahlenband` hat eine feste Spaltenzahl, die die Seite
 * über `useViewport` wählt (ab `xl` sechs, ab `md` drei, darunter zwei); die Paneele stehen ab
 * `lg` nebeneinander. Die Breite der Fläche wird trotzdem protokolliert, damit eine
 * Schwellenverschiebung nachgerechnet werden kann.
 *
 * Kein Device-Descriptor. Gemessen wird die Fläche des Dashboards, nicht `body.scrollWidth` —
 * der dokumentweite Überlauf hängt am Navigationsrahmen (`nav-schmal.spec.ts`).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

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

/** Einmal angelegt, von allen Tests der Datei weiterbenutzt. */
let einsatzId: string | null = null;

const BAND = (page: Page) => page.getByRole('group', { name: 'Lage in Zahlen' });
const FLAECHE = (page: Page) => page.locator('[data-lfh="lagebild"]');
const PANEELE = (page: Page) => page.locator('[data-lfh="lagebild-paneele"]');

/**
 * Meldet an, stellt die Prüfbreite ein und öffnet das Dashboard. Anmeldung und Anlegen laufen
 * im Default-Viewport: auf 390 px liegt „Neuer Einsatz" hinter dem Kopfgriff.
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
  // Genau ein Knoten — sonst wäre eine grüne Zusicherung grün durch Nichtstun.
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
      // Belegt, dass alle drei Tests DIESELBE Vorbedingung teilen.
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
 * Jede Kennzahl steht vollständig in ihrer eigenen Zelle. Das Band ist ein Raster aus
 * `minmax(0, 1fr)` und bekommt nie eine Bildlaufleiste — zu schmale Spalten zeigen sich erst
 * hier, wenn Wert oder Notiz über die Zelle laufen.
 */
async function jedeKennzahlStehtInIhrerZelle(page: Page) {
  const masse = await BAND(page).evaluate((el) =>
    Array.from(el.querySelectorAll('[data-lfh="kennzahl"]')).map((k) => ({
      scroll: k.scrollWidth,
      klient: k.clientWidth,
    })),
  );
  // Immer sechs Plätze, gleich welche Lagekennzahlen der Einsatz trägt.
  expect(masse).toHaveLength(6);
  for (const [i, mass] of masse.entries()) {
    expect(mass.scroll, `Kennzahl ${i + 1}: Inhalt läuft aus der Zelle`).toBeLessThanOrEqual(
      mass.klient + 1,
    );
    expect(mass.klient, `Kennzahl ${i + 1} ohne Breite`).toBeGreaterThan(0);
  }
}

// Kein `.serial`: die Tests sind unabhängig, und im Reihen-Modus verdeckte ein Fehlschlag die
// Messwerte der übrigen Breiten.
test.describe('Lage-Dashboard auf den drei Prüfbreiten', () => {
  test('am Fükw-Schirm (1366 px) sechs Kennzahlen in einer Reihe, drei Paneele nebeneinander', async ({
    page,
  }) => {
    // Fükw: ≥ `xl` sechs Spalten, ≥ `lg` Paneele nebeneinander.
    await dashboardOeffnen(page, 1366, 768);
    const mass = await messen(page, 1366);
    expect(mass.spalten, 'Band-Spalten am Fükw-Schirm').toBe(6);
    expect(mass.paneelSpalten, 'Paneele am Fükw-Schirm').toBe(3);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhrerZelle(page);
  });

  test('bei 1024 px drei Spalten im Band, die Paneele noch nebeneinander', async ({ page }) => {
    // Führungs-Tablet zwischen `lg` und `xl`: Band 3 × 2, Paneele dreispaltig — der Engpass.
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
    // Handschirm: Band 2 Spalten × 3 Zeilen, Paneele gestapelt. Zwei Aussagen an einer
    // Messung: „kein Überlauf" fängt eine zu breite Mindestspalte, „jede Kennzahl in ihrer
    // Zelle" eine zu schmale.
    await dashboardOeffnen(page, 390, 844);
    const mass = await messen(page, 390);
    expect(mass.spalten, 'Band-Spalten am Handschirm').toBe(2);
    expect(mass.paneelSpalten, 'Paneele am Handschirm').toBe(1);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhrerZelle(page);
  });
});
