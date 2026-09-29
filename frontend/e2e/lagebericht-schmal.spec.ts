import { expect, test, type Page } from '@playwright/test';

/**
 * Lagebericht am Fükw-Maß und am schmalen Schirm: Seitenhöhe der Detailseite und
 * waagerechter Überlauf der beiden Listen.
 *
 * `MAX_HOEHE` ist gemessen, keine Setzung: die halbe Höhe der Seite mit acht offenen
 * Split-Editoren ohne Navigation. Gemessen wird `document.body.scrollHeight` — die
 * Scrollstrecke, die die Person am 13"-Schirm zurücklegt.
 *
 * Kein Device-Descriptor; Anmelden und Anlegen am Fükw-Maß, erst danach umstellen. Seeding per
 * `page.request`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Halbe Bestandshöhe: ohne Akkordeon maß die Seite 2108 px. Der Körper hat einen Boden von
 * `100vh` = 768 px — darunter kann keine Seite fallen.
 */
const MAX_HOEHE = 1054;

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

/** Lagevortrag zur Entscheidung: die Vorlage mit den meisten Abschnitten (acht). */
async function lageberichtAnlegen(page: Page, einsatzId: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/lageberichte`, {
    data: { vorlage: 'lagebeurteilung', titel: 'Lagevortrag zur Entscheidung 1000' },
  });
  expect(antwort.ok(), await antwort.text()).toBe(true);
  return (await antwort.json()).id as number;
}

/** Eine Meldung anlegen und an die Lage übergeben — erst dann hat die Liste eine Zeile. */
async function lagemeldungAnlegen(page: Page, einsatzId: string) {
  const m = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
    data: {
      absender: 'Florian Nord 1',
      meldeweg: 'funk',
      inhalt: 'Brücke Nord gesperrt, Umleitung über die B12 eingerichtet, Rückstau bis Ortsmitte',
      ereigniszeit: new Date().toISOString(),
    },
  });
  expect(m.ok(), await m.text()).toBe(true);
  const meldung = await m.json();
  const l = await page.request.post(
    `/api/einsaetze/${einsatzId}/meldungen/${meldung.id}/lagerelevant`,
    { data: { lat: 50.11, lon: 8.68 } },
  );
  expect(l.ok(), await l.text()).toBe(true);
}

// Erster Lauf je Datei zahlt den Vite-Kaltstart der Detail- und Listenrouten mit.
test.setTimeout(90_000);

/** `body.scrollHeight`, sobald drei Messungen im Abstand von 250 ms gleich sind. */
async function stabileHoehe(page: Page): Promise<number> {
  let letzte = -1;
  let gleich = 0;
  for (let i = 0; i < 40 && gleich < 3; i += 1) {
    await page.waitForTimeout(250);
    const jetzt = await page.evaluate(() => document.body.scrollHeight);
    gleich = jetzt === letzte ? gleich + 1 : 0;
    letzte = jetzt;
  }
  expect(gleich, 'Seitenhöhe kam nicht zur Ruhe').toBeGreaterThanOrEqual(3);
  return letzte;
}

let einsatzId: string | null = null;
let berichtId: number | null = null;

async function vorbereiten(page: Page) {
  await anmelden(page);
  einsatzId ??= await einsatzAnlegen(page, `E2E Lagebericht ${Date.now()}`);
  berichtId ??= await lageberichtAnlegen(page, einsatzId);
}

test('Detailseite „Lagevortrag zur Entscheidung" bleibt bei 1366 px unter der halben Bestandshöhe', async ({
  page,
}) => {
  await vorbereiten(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${berichtId}`);
  await expect(page.getByLabel('Auftrag')).toBeVisible();
  await expect(page.getByLabel('Vorschlag der besten Möglichkeit')).toBeAttached();

  // Erst messen, wenn die Höhe STEHT: `autoSize` misst die Textfelder nach dem Einhängen nach.
  const hoehe = await stabileHoehe(page);
  const detail = await page.evaluate(() => ({
    form: document.querySelector('form')?.getBoundingClientRect().height ?? -1,
    textarea: document.querySelector('textarea')?.getBoundingClientRect().height ?? -1,
    innerHeight: window.innerHeight,
  }));
  console.log(
    `[gemessen] body.scrollHeight = ${hoehe} px bei 1366×768; form ${detail.form} px, ` +
      `textarea ${detail.textarea} px, innerHeight ${detail.innerHeight}`,
  );
  test.info().annotations.push({
    type: 'gemessen',
    description: `body.scrollHeight = ${hoehe} px bei 1366×768, Einsatz ${einsatzId}, Bericht ${berichtId}`,
  });
  expect(hoehe).toBeLessThanOrEqual(MAX_HOEHE);
});

for (const pfad of ['lageberichte', 'lagemeldungen'] as const) {
  test(`/${pfad}: kein waagerechter Überlauf bei 390 px`, async ({ page }) => {
    await vorbereiten(page);
    if (pfad === 'lagemeldungen') await lagemeldungAnlegen(page, einsatzId!);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/einsaetze/${einsatzId}/${pfad}`);
    // Der Titel ist das h1 der `EinsatzSeite`-Kopfleiste.
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: pfad === 'lageberichte' ? 'Lageberichte' : 'Lagerelevante Meldungen',
      }),
    ).toBeVisible();
    // Der gesäte Datensatz als Anker: eine leere Seite hätte trivial keinen Überlauf.
    await expect(
      page.getByText(
        pfad === 'lageberichte' ? 'Lagevortrag zur Entscheidung 1000' : /Brücke Nord gesperrt/,
      ),
    ).toBeVisible();
    const mass = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      klient: document.documentElement.clientWidth,
    }));
    expect(mass.scroll, `${pfad}: Body breiter als der Viewport`).toBeLessThanOrEqual(
      mass.klient + 1,
    );
  });
}
