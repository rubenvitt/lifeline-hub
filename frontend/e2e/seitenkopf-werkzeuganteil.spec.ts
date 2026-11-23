import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';
import { anmelden, einsatzAnlegen, anlegen, ladeInDichte } from './trefflaeche-kern';

/**
 * Werkzeuganteil der Listenseiten (LLH-1786, Change `z137bgm5-seitenkopf-einzeilig`, Spec
 * `einsatztauglichkeit-layout`, „Die erste Datenzeile steht oben im Fenster“ und „Der Seitenkopf
 * bündelt Nebenwege unter md und ab Stufe 48“).
 *
 * Gemessen wird die Oberkante der ersten Datenzeile beim Öffnen, OHNE Bildlauf: das ist die
 * Aussage des Tickets („erste Datenzeile bei y …“). Eine Datenzeile ist eine Tabellenzeile oder
 * eine Karte der `Datensicht`. Die Werte stehen als Anmerkung am Test, damit der PR Ausgangs- und
 * Endstand nennen kann.
 */

const TABLET_QUER = { width: 1180, height: 820 };
const HANDSCHIRM = { width: 390, height: 844 };

/** Handschirm-Grenze der Spec, als Literal. */
const HANDSCHIRM_OBERKANTE = 350;

const ERSTE_ZEILE = '.ant-table-tbody > tr.ant-table-row, [data-lfh="datensicht-karte"]';

const FAHRZEUG = 'Florian Werkzeug 1';
const KRAFT = 'Werkzeug, Kurt';
const EINHEIT = 'Werkzeugzug';
const STELLE = 'Werkzeughalle';

async function einsatzMitListen(page: Page): Promise<string> {
  const einsatzId = await einsatzAnlegen(page, `E2E Werkzeuganteil ${Date.now()}`);
  await anlegen(
    page,
    einsatzId,
    'personen',
    { name: 'Werkzeug', vorname: 'Wilma', antreff_ort: 'Halle' },
    'Person',
  );
  await anlegen(
    page,
    einsatzId,
    'vehicles',
    { adhoc: { funkrufname: FAHRZEUG, fahrzeugtyp: 'LF 20' } },
    'Fahrzeug',
  );
  await anlegen(page, einsatzId, 'personnel', { adhoc: { name: KRAFT } }, 'Kraft');
  await anlegen(page, einsatzId, 'units', { name: EINHEIT }, 'Einheit');
  await anlegen(
    page,
    einsatzId,
    'betreuung/stellen',
    { bezeichnung: STELLE, art: 'notunterkunft', kapazitaet_personen: 30 },
    'Betreuungsstelle',
  );
  return einsatzId;
}

/** Seite → Datenanker (steht in der ersten Zeile). */
const SEITEN = [
  { route: 'personen', anker: 'Werkzeug' },
  { route: 'kraefteuebersicht', anker: EINHEIT },
  { route: 'fahrzeuge', anker: FAHRZEUG },
  { route: 'personal', anker: KRAFT },
  { route: 'einheiten', anker: EINHEIT },
] as const;

/** Ober- und Unterkante der ersten Datenzeile, nachdem der Anker steht. */
async function ersteZeile(page: Page, anker: string): Promise<{ y: number; unten: number }> {
  const zeile = page.locator(ERSTE_ZEILE).filter({ hasText: anker }).first();
  await expect(zeile).toBeVisible();
  // Gemessen wird am Anfang der Seite: kein Fokus- oder Ankersprung darf die Zahl schönen.
  expect(await page.evaluate(() => window.scrollY), 'Seite ist gerollt').toBe(0);
  const kasten = await page.locator(ERSTE_ZEILE).first().boundingBox();
  expect(kasten, 'erste Zeile ohne Kasten').not.toBeNull();
  return { y: kasten!.y, unten: kasten!.y + kasten!.height };
}

async function ersteZeileOben(page: Page, anker: string): Promise<number> {
  return (await ersteZeile(page, anker)).y;
}

function vermerke(name: string, y: number) {
  const text = `${name}: y = ${Math.round(y)}`;
  test.info().annotations.push({ type: 'erste Datenzeile', description: text });
  console.log(`erste Datenzeile ${text}`);
}

test.describe('Werkzeuganteil am Tablet quer, Handschuh', () => {
  test.use({ viewport: TABLET_QUER, hasTouch: true });

  test('Die erste Datenzeile jeder Listenseite steht vollständig im Fenster', async ({ page }) => {
    test.setTimeout(120_000);
    await anmelden(page, { startseite: false });
    const einsatzId = await einsatzMitListen(page);
    for (const seite of SEITEN) {
      await ladeInDichte(page, `/einsaetze/${einsatzId}/${seite.route}`, 'handschuh');
      const { y, unten } = await ersteZeile(page, seite.anker);
      vermerke(`${seite.route} handschuh`, y);
      // Senkrecht gemessen: eine breite Tabelle darf seitwärts rollen (Spalten rechts), die
      // Aussage ist „ohne Bildlauf nach unten im Fenster“. Weich, damit jede Seite gemessen wird.
      expect
        .soft(
          unten,
          `${seite.route}: erste Datenzeile von y = ${Math.round(y)} bis ${Math.round(unten)}`,
        )
        .toBeLessThanOrEqual(TABLET_QUER.height);
    }
  });

  for (const dichte of ['komfortabel', 'handschuh'] as const) {
    test(`Nebenwege der Betroffenen stehen in ${dichte} nur im Menü`, async ({ page }) => {
      await anmelden(page, { startseite: false });
      const einsatzId = await einsatzMitListen(page);
      await ladeInDichte(page, `/einsaetze/${einsatzId}/personen`, dichte);
      const kopf = page.locator('[data-lfh="seitenkopf"]');
      await expect(kopf.getByRole('button', { name: 'Betroffene erfassen' })).toBeVisible();
      await expect(kopf.getByRole('button', { name: 'Vermisst melden' })).toBeVisible();
      // Die Betroffenenliste druckt über ihre Druckseite: „Druckansicht“ (LLH-1836).
      await expect(kopf.getByRole('link', { name: 'Druckansicht' })).toHaveCount(0);
      await expect(kopf.getByRole('button', { name: 'CSV exportieren' })).toHaveCount(0);
      await kopf.getByRole('button', { name: 'Weitere Aktionen zu den Betroffenen' }).click();
      await expect(page.getByRole('menuitem', { name: 'CSV exportieren' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Druckansicht' })).toBeVisible();
    });
  }
});

test.describe('Klappbare Kennzahlen', () => {
  test.use({ viewport: TABLET_QUER, hasTouch: true });

  test('Statusband im Handschuh: Klappkopf in Stufenhöhe, eingeklappt nach dem Neuladen, Liste rückt hoch', async ({
    page,
  }) => {
    await anmelden(page, { startseite: false });
    const einsatzId = await einsatzMitListen(page);
    await ladeInDichte(page, `/einsaetze/${einsatzId}/kraefteuebersicht`, 'handschuh');
    const offen = await ersteZeileOben(page, EINHEIT);
    const kopf = page.getByRole('button', { name: /^Status in Zahlen/ });
    await expect(kopf).toHaveAttribute('aria-expanded', 'true');
    const kasten = await kopf.boundingBox();
    expect(kasten!.height, 'Klappkopf in handschuh').toBeGreaterThanOrEqual(72 - 0.5);

    await kopf.click();
    await page.reload();
    await expect(page.getByRole('button', { name: /^Status in Zahlen/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByRole('button', { name: /^Status in Zahlen/ })).toContainText('Einheit');
    const zu = await ersteZeileOben(page, EINHEIT);
    vermerke('kraefteuebersicht handschuh eingeklappt', zu);
    expect(zu, 'eingeklappt beginnt die Tabelle höher').toBeLessThan(offen);
  });
});

test.describe('Werkzeuganteil am Handschirm', () => {
  test.use({ viewport: HANDSCHIRM, hasTouch: true });

  test('Fahrzeuge und Betreuung beginnen oben', async ({ page }) => {
    await anmelden(page, { startseite: false });
    const einsatzId = await einsatzMitListen(page);

    await ladeInDichte(page, `/einsaetze/${einsatzId}/fahrzeuge`, 'kompakt');
    const fahrzeuge = await ersteZeileOben(page, FAHRZEUG);
    vermerke('fahrzeuge handschirm', fahrzeuge);

    await page.goto(`/einsaetze/${einsatzId}/betreuung`);
    await expect(page.getByText(STELLE).first()).toBeVisible();
    // Vorbedingung der Spec: Kennzahlen eingeklappt (die Wahl bleibt auf dem Gerät).
    const klappe = page.getByRole('button', { name: /Unterbringung/, expanded: true });
    if ((await klappe.count()) > 0) {
      await klappe.first().click();
      await page.reload();
    }
    const betreuung = await ersteZeileOben(page, STELLE);
    vermerke('betreuung handschirm', betreuung);

    expect(fahrzeuge, 'Fahrzeuge').toBeLessThanOrEqual(HANDSCHIRM_OBERKANTE);
    expect(betreuung, 'Betreuung').toBeLessThanOrEqual(HANDSCHIRM_OBERKANTE);
  });

  test('Die Betroffenenliste beginnt für den Beobachter oben', async ({ page }) => {
    await anmelden(page, { startseite: false });
    const einsatzId = await einsatzMitListen(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await ladeInDichte(page, `/einsaetze/${einsatzId}/personen`, 'kompakt');
    // Rollenzweig als Vorbedingung (LFH-435): kein Erfassungsknopf.
    await expect(page.getByRole('button', { name: 'Betroffene erfassen' })).toHaveCount(0);
    const y = await ersteZeileOben(page, 'Werkzeug');
    vermerke('personen handschirm beobachter', y);
    expect(y).toBeLessThanOrEqual(HANDSCHIRM_OBERKANTE);
  });
});
