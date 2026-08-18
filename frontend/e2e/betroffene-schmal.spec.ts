import { expect, test, type Page } from '@playwright/test';

/**
 * Die Betroffenen-Module am Handschirm (LFH-340 · C5, AK 5).
 *
 * Bis C5 trug keine der drei Listen einen Breakpoint: `personenSpalten` vergab 320 von
 * 342 px fest, die Schadensliste rannte in eine handgebaute Tabelle. Geprüft wird deshalb
 * die WEICHE, nicht die Kosmetik — bei 390 px steht der Kartenzweig, bei 1366 px die
 * Tabelle, und der Body läuft in keinem der beiden Fälle waagerecht über.
 *
 * ── AN- UND ABWESENHEIT, JE MIT GEGENPROBE ──────────────────────────────────────────────
 *
 * „kein `.ant-table` bei 390 px" allein belegt nichts: eine Seite, die aus irgendeinem
 * anderen Grund keine Tabelle rendert — Ladezustand, Leerzustand, Redirect — erfüllt das
 * ebenso. Erst das Paar aus Abwesenheit unten und Anwesenheit oben, mit demselben gesäten
 * Datensatz als Anker in beiden, schließt das aus. Dieselbe Begründung steht in
 * `datensicht-schmal.spec.ts`, das die Weiche am Primitiv misst; hier geht es um die drei
 * Modulrouten, die sie konsumieren.
 *
 * ── WAS HIER BEWUSST NICHT GEMESSEN WIRD ────────────────────────────────────────────────
 *
 * Kein `waitForLoadState('networkidle')`: auf Einsatzrouten bleibt ein SSE-Strom offen, die
 * Bedingung „500 ms keine Netzwerkaktivität" tritt dort nie sauber ein (in
 * `trefflaeche-tablet.spec.ts` gemessen, als LFH-385 erfasst). Die Zusicherungen warten von
 * sich aus und sind inhaltlich statt netzwerklich.
 *
 * Kein Device-Descriptor und kein zweites Playwright-Projekt — ein `devices['iPhone …']`
 * zöge webkit nach, und ein Browser-Download ist im Repo nirgends abgesichert
 * (gleichlautend in sechs Bestands-Specs begründet).
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };
const FUEKW = { width: 1366, height: 900 };

/** Subpixel-Spielraum: Chromium rechnet unter Last anders als im Einzellauf. */
const SUBPIXEL = 0.5;

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul
// (gleichlautend in sechs Bestands-Specs vermerkt).
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

/** Seeding per `page.request`: die Session ist Cookie-basiert, der Jar wird geteilt. */
async function seede(page: Page, einsatzId: string, pfad: string, data: unknown, was: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/**
 * Je Modul ein Datensatz mit einem Wortlaut, der erst MIT den Daten erscheint.
 *
 * Der Anker ist nicht Zierde: eine Messung vor dem Inhalt prüft den Ladezustand, und ohne
 * Zeilen gibt es keinen Überlauf — der Test wäre grün, während die Seite in Wirklichkeit
 * überliefe. Dieselbe teuer gelernte Lehre steht in `kraefte-schmal.spec.ts`.
 */
const MODULE = [
  { route: 'personen', anker: /R-\d{3}/, was: 'Person' },
  { route: 'tiere', anker: /T-\d{3}/, was: 'Tier' },
  { route: 'schaeden', anker: /S-\d{3}/, was: 'Schaden' },
] as const;

async function seedeAlles(page: Page, einsatzId: string) {
  await seede(page, einsatzId, 'personen', { antreff_ort: 'Sammelstelle Süd' }, 'Person');
  await seede(page, einsatzId, 'tiere', { spezies: 'hund', rufname: 'Rex' }, 'Tier');
  await seede(
    page,
    einsatzId,
    'schaeden',
    { typ: 'sachschaden', ausmass: 'gering', ort: 'Hauptstr. 17', beschreibung: 'Dachziegel' },
    'Schaden',
  );
}

/** Waagerechter Überlauf des Dokuments — die eigentliche Aussage von AK 5. */
async function keinQuerlauf(page: Page, pfad: string) {
  await expect
    .poll(
      async () =>
        page
          .evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }))
          .then((m) => m.scroll - m.client),
      { message: `${pfad} läuft waagerecht über` },
    )
    .toBeLessThanOrEqual(SUBPIXEL);
}

test('bei 390 px steht auf allen drei Listen die Karte statt der Tabelle, ohne Querlauf', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene schmal ${Date.now()}`);
  await seedeAlles(page, einsatzId);

  await page.setViewportSize(HANDSCHIRM);
  for (const modul of MODULE) {
    const pfad = `/einsaetze/${einsatzId}/${modul.route}`;
    await page.goto(pfad);
    // Der Anker steht VOR jeder Messung — sonst prüft der Test den Ladezustand.
    await expect(page.getByText(modul.anker).first(), `${pfad}: Datensatz muss stehen`).toBeVisible();

    await expect(page.locator('[data-lfh="datensicht-karte"]').first(), `${pfad}: Kartenzweig`)
      .toBeVisible();
    await expect(page.locator('.ant-table'), `${pfad}: keine Tabelle bei 390 px`).toHaveCount(0);
    await keinQuerlauf(page, pfad);
  }
});

test('bei 1366 px steht auf allen drei Listen die Tabelle statt der Karte', async ({ page }) => {
  // Die Gegenprobe. Ohne sie wäre der Fall oben auch grün, wenn die Weiche bei JEDER Breite
  // in den Kartenzweig kippt — also gerade dann, wenn der Fükw seine Vergleichsansicht
  // verliert.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene breit ${Date.now()}`);
  await seedeAlles(page, einsatzId);

  await page.setViewportSize(FUEKW);
  for (const modul of MODULE) {
    const pfad = `/einsaetze/${einsatzId}/${modul.route}`;
    await page.goto(pfad);
    await expect(page.getByText(modul.anker).first(), `${pfad}: Datensatz muss stehen`).toBeVisible();

    await expect(page.locator('.ant-table').first(), `${pfad}: Tabellenzweig`).toBeVisible();
    await expect(
      page.locator('[data-lfh="datensicht-karte"]'),
      `${pfad}: keine Karten bei 1366 px`,
    ).toHaveCount(0);
    await keinQuerlauf(page, pfad);
  }
});
