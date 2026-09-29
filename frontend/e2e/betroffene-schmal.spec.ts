import { expect, test, type Locator, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Die Betroffenen-Module am Handschirm: geprüft wird die WEICHE — bei 390 px der Kartenzweig,
 * bei 1366 px die Tabelle — und dass der Body in keinem Fall waagerecht überläuft.
 *
 * AN- UND ABWESENHEIT, JE MIT GEGENPROBE: „kein `.ant-table` bei 390 px" erfüllt auch ein
 * Lade-, Leer- oder Redirect-Zustand; erst das Paar mit demselben gesäten Datensatz als Anker
 * schließt das aus.
 *
 * Dazu die Treffflächen über zwei Dichtestufen (Titel-Links bei 390 px, Spaltenschalter bei
 * 1366 px) gegen die Staffel 48 / 72 als Literale — ein fester Wert von 48 px fällt erst im
 * Handschuh-Durchgang durch.
 *
 * Kein `networkidle` (SSE-Strom), kein Device-Descriptor.
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
 * Je Modul ein Datensatz mit einem Wortlaut, der erst MIT den Daten erscheint — ohne Zeilen
 * gibt es keinen Überlauf, eine Messung vor dem Inhalt prüfte den Ladezustand.
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
  // Vor JEDER Messung, auch nach einem Routenwechsel: „Stufe nicht angekommen" muss von
  // „Ziel zu klein" unterscheidbar bleiben.
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

/**
 * Kopfaktionen, die der Nur-Lese-Zweig versteckt (`PersonenPage.tsx`, `TierePage.tsx`,
 * `SchaedenPage.tsx`: `aktionen` nur mit `darfSchreiben`), und je Route ein Geschwister, das
 * BLEIBT — erst dessen Sichtbarkeit belegt, dass die Seite gerendert hat, sonst wäre die
 * Abwesenheit auch bei einem Tippfehler im Namen grün.
 */
const LESEZWEIG: Record<(typeof MODULE)[number]['route'], { weg: string[]; bleibt?: string }> = {
  personen: {
    weg: ['Schnellerfassung', 'Vermisst melden', 'Betroffene/n erfassen'],
    bleibt: 'Ansicht',
  },
  tiere: { weg: ['Schnellerfassung', 'Vermisst melden'], bleibt: 'Tiere nach Status filtern' },
  schaeden: { weg: ['Schnellerfassung'] },
};

/**
 * LFH-435 · Zweig: Beobachter (kein Schreibrecht). Der Kopf verliert seine Erfassungsknöpfe,
 * die Karte ihre Bedienung; gemessen wird wie im Admin-Geschwister oben (Kartenzweig, keine
 * Tabelle, kein Querlauf), dazu, dass die Karte ohne Bedienziele nicht in sich zusammenfällt.
 */
test('bei 390 px steht auf allen drei Listen die Karte statt der Tabelle, ohne Querlauf (Beobachter)', async ({
  page,
}) => {
  // Zusätzliche Anmeldung gegenüber dem Admin-Geschwister.
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene lesend ${Date.now()}`);
  await seedeAlles(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  await page.setViewportSize(HANDSCHIRM);
  for (const modul of MODULE) {
    const pfad = `/einsaetze/${einsatzId}/${modul.route}`;
    await page.goto(pfad);
    await expect(
      page.getByText(modul.anker).first(),
      `${pfad}: Datensatz muss stehen`,
    ).toBeVisible();

    // ── VORBEDINGUNGEN: der Nur-Lese-Zweig steht.
    const { weg, bleibt } = LESEZWEIG[modul.route];
    if (bleibt) {
      await expect(
        page.getByRole('radiogroup', { name: bleibt }),
        `${pfad}: Vorbedingung — „${bleibt}" bleibt auch ohne Schreibrecht`,
      ).toBeVisible();
    }
    for (const name of weg) {
      await expect(
        page.getByRole('button', { name, exact: true }),
        `${pfad}: Vorbedingung — ohne Schreibrecht kein „${name}"`,
      ).toHaveCount(0);
    }

    // ── MESSUNG: Kartenzweig, der nicht kollabiert, keine Tabelle, kein Querlauf.
    const karte = page.locator('[data-lfh="datensicht-karte"]');
    await expect(karte, `${pfad}: genau eine Karte`).toHaveCount(1);
    await expect(karte, `${pfad}: Kartenzweig`).toBeVisible();
    const kasten = await karte.boundingBox();
    expect(kasten, `${pfad}: Karte nicht messbar`).not.toBeNull();
    expect(
      kasten!.width,
      `${pfad}: Karte kollabiert (gemessen ${kasten!.width} px breit)`,
    ).toBeGreaterThanOrEqual(HANDSCHIRM.width / 2);
    expect(
      kasten!.height,
      `${pfad}: Karte kollabiert (gemessen ${kasten!.height} px hoch)`,
    ).toBeGreaterThanOrEqual(24);
    await expect(page.locator('.ant-table'), `${pfad}: keine Tabelle bei 390 px`).toHaveCount(0);
    await keinQuerlauf(page, pfad);
  }
});

test('bei 1366 px steht auf allen drei Listen die Tabelle statt der Karte', async ({ page }) => {
  // Die Gegenprobe: sonst wäre der Fall oben auch grün, wenn die Weiche bei JEDER Breite in
  // den Kartenzweig kippt.
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
  // Nur die Breite zu ändern erzeugt kein `pointer: coarse`; die gespeicherte Wahl bestimmt
  // die Stufe.
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
