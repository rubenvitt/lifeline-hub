import { expect, test, type Browser, type Page } from '@playwright/test';
import { anmeldenPerApi } from './anmelde-kern';
import { einsatzPerApi } from './einsatz-kern';

/**
 * Präsenz an Einzelangaben (LLH-1946, Entwurf
 * `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`): A öffnet eine Angabe,
 * B sieht daran „Wird gerade … bearbeitet“; schließt A, verschwindet der Hinweis bei B. Über zwei
 * Browserkontexte mit demselben Konto: das ist der Ablauf über Live-Strom und zwei Tabs, den nur
 * der Browser zeigt (Wortlaut „in einem anderen Fenster dieses Kontos“).
 *
 * Diskriminierend: ohne Meldung beim Öffnen oder ohne Verteilung im Strom erscheint bei B nichts;
 * ohne Ende beim Abbrechen bliebe der Hinweis 45 s stehen und die Frist unten liefe ab.
 */
const ADMIN = 'admin';
const ADMIN_PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const HINWEIS = 'Wird gerade in einem anderen Fenster dieses Kontos bearbeitet';

async function zweiterKontext(
  browser: Browser,
): Promise<{ b: Page; schliessen: () => Promise<void> }> {
  const kontext = await browser.newContext();
  const b = await kontext.newPage();
  await anmeldenPerApi(b, ADMIN, ADMIN_PW, { startseite: false });
  return { b, schliessen: () => kontext.close() };
}

test('Einsatzdaten · Leitstellen-Nr.: B sieht, dass A bearbeitet, bis A abbricht', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Präsenz ${Date.now()}`);
  const pfad = `/einsaetze/${einsatzId}/einsatzdaten`;
  const { b, schliessen } = await zweiterKontext(browser);
  try {
    await b.goto(pfad);
    await expect(b.getByRole('button', { name: 'Leitstellen-Nr. eintragen' })).toBeVisible();
    const hinweisB = b.locator('[data-lfh="feld-praesenz"]', { hasText: HINWEIS });
    await expect(hinweisB).toHaveCount(0);

    await page.goto(pfad);
    await page.getByRole('button', { name: 'Leitstellen-Nr. eintragen' }).click();
    await expect(page.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toBeVisible();

    await expect(hinweisB).toBeVisible({ timeout: 5_000 });
    // A sieht an seiner eigenen offenen Eingabe keinen Hinweis.
    await expect(page.locator('[data-lfh="feld-praesenz"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Bearbeitung von Leitstellen-Nr. abbrechen' }).click();
    await expect(hinweisB).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await schliessen();
  }
});

test('Einheit · Bemerkung: der Hinweis steht an der Zeile und weicht beim Abbrechen', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await anmeldenPerApi(page, ADMIN, ADMIN_PW, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Präsenz Einheit ${Date.now()}`);
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/units`, {
    data: { name: 'Trupp Präsenz' },
  });
  expect(antwort.ok()).toBe(true);
  const { id: eid } = (await antwort.json()) as { id: number };
  const pfad = `/einsaetze/${einsatzId}/einheiten/${eid}`;
  const { b, schliessen } = await zweiterKontext(browser);
  try {
    await b.goto(pfad);
    await expect(b.getByRole('button', { name: 'Bemerkung eintragen' })).toBeVisible();
    const hinweisB = b.locator('[data-lfh="feld-praesenz"]', { hasText: HINWEIS });

    await page.goto(pfad);
    await page.getByRole('button', { name: 'Bemerkung eintragen' }).click();
    await expect(hinweisB).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Bearbeitung von Bemerkung abbrechen' }).click();
    await expect(hinweisB).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await schliessen();
  }
});
