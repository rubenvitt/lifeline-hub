import { expect, test, type Locator, type Page } from '@playwright/test';

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
 * LFH-454 ergänzt die gerenderten Treffflächen über zwei Dichtestufen: Titel-Links der
 * Karten bei 390 px, Spaltenschalter bei 1366 px. Die Schwelle ist die Staffel 48 / 72,
 * nicht 44 px — sonst bliebe eine Regression auf 44–47 px unbemerkt. Ein fester Wert
 * von 48 px fällt erst im Handschuh-Durchgang durch. Die Sollwerte bleiben Literale,
 * damit der Test nicht einen importierten Produktiv-Token gegen sich selbst prüft.
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

const STAFFEL = [
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

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

/** Der Provider liest die gespeicherte Wahl beim Montieren, deshalb das Neuladen. */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/** Misst genau das Bedienziel, nachdem Inhalt und Dichtestufe angekommen sind. */
async function haeltStufe(page: Page, ziel: Locator, dichte: string, soll: number, name: string) {
  await expect(ziel, `${name}: genau ein Bedienziel`).toHaveCount(1);
  await expect(ziel, `${name}: Bedienziel sichtbar`).toBeVisible();
  // Vor JEDER Messung, auch nach einem Routenwechsel: „Stufe nicht angekommen" muss
  // von „Ziel zu klein" unterscheidbar bleiben.
  await expect(page.locator('html'), `${name}: aktive Dichtestufe`).toHaveAttribute(
    'data-dichte',
    dichte,
  );
  const kasten = await ziel.boundingBox();
  expect(kasten, `${name}: kein Kasten messbar`).not.toBeNull();
  expect(
    kasten!.height,
    `${name} (${dichte}): gemessen ${kasten!.height} px, Soll ≥ ${soll} px`,
  ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
  return kasten!.height;
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
    await expect(
      page.getByText(modul.anker).first(),
      `${pfad}: Datensatz muss stehen`,
    ).toBeVisible();

    await expect(
      page.locator('[data-lfh="datensicht-karte"]').first(),
      `${pfad}: Kartenzweig`,
    ).toBeVisible();
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
    await expect(
      page.getByText(modul.anker).first(),
      `${pfad}: Datensatz muss stehen`,
    ).toBeVisible();

    await expect(page.locator('.ant-table').first(), `${pfad}: Tabellenzweig`).toBeVisible();
    await expect(
      page.locator('[data-lfh="datensicht-karte"]'),
      `${pfad}: keine Karten bei 1366 px`,
    ).toHaveCount(0);
    await keinQuerlauf(page, pfad);
  }
});

test.describe('LFH-454: Treffflächen der Betroffenen-Routen', () => {
  // Nur die Breite zu ändern erzeugt kein `pointer: coarse`. Der Touch-Kontext gilt
  // für beide Breiten; die gespeicherte Wahl bestimmt darin die jeweilige Stufe.
  test.use({ hasTouch: true });

  for (const { dichte, soll } of STAFFEL) {
    for (const { viewport, art, zielName } of [
      { viewport: HANDSCHIRM, art: 'karte', zielName: 'Titel-Link' },
      { viewport: FUEKW, art: 'tabelle', zielName: 'Spaltenschalter' },
    ] as const) {
      test(`${dichte}: ${zielName} hält auf allen drei Routen bei ${viewport.width} px die Stufe ${soll} px`, async ({
        page,
      }, testInfo) => {
        await anmelden(page);
        const einsatzId = await einsatzAnlegen(page, `E2E Betroffene ${dichte} ${Date.now()}`);
        await seedeAlles(page, einsatzId);
        await stelleDichte(page, dichte);
        await page.setViewportSize(viewport);

        const gemessen: string[] = [];
        for (const modul of MODULE) {
          const pfad = `/einsaetze/${einsatzId}/${modul.route}`;
          await page.goto(pfad);
          const bereich = page.locator(
            art === 'karte' ? '[data-lfh="datensicht-karte"]' : 'tr.ant-table-row',
          );
          await expect(bereich, `${pfad}: genau ein gesäter Datensatz`).toHaveCount(1);
          await expect(
            bereich.getByText(modul.anker),
            `${pfad}: Datensatz muss stehen`,
          ).toBeVisible();

          const ziel =
            art === 'karte'
              ? bereich.getByRole('link', { name: modul.anker })
              : page
                  .locator('[data-lfh="datensicht-werkzeuge"]')
                  .getByRole('button', { name: /^Spalten/ });
          if (art === 'karte') {
            await expect(ziel).toHaveAttribute(
              'href',
              new RegExp(`/einsaetze/${einsatzId}/${modul.route}/\\d+$`),
            );
          }
          const hoehe = await haeltStufe(page, ziel, dichte, soll, `${pfad}: ${zielName}`);
          gemessen.push(`${modul.route}: ${zielName} ${hoehe} px (Soll ≥ ${soll} px)`);
        }

        await testInfo.attach('Treffflächen-Messwerte', {
          body: gemessen.join('\n'),
          contentType: 'text/plain',
        });
      });
    }
  }
});
