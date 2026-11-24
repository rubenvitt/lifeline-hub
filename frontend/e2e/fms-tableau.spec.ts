import { expect, test, type Page } from '@playwright/test';
import { anmeldenPerApi } from './anmelde-kern';

/**
 * FMS-Tableau im echten Browser:
 *  1. Kein waagerechter Querlauf auf 390, 1024 und 1366 px (Raster
 *     `repeat(auto-fill, minmax(min(100%, 240px), 1fr))`, LLH-1782); eine einzelne Kachel in
 *     einem Abschnitt ist bei 1366 px nicht breiter als eine Spalte.
 *  2. Die Ziffer setzt den Status gegen das echte Backend, und der Wechsel überlebt das
 *     Neuladen — derselbe PATCH wie das Menü. Nach jeder Ziffer steht die Quittung
 *     „<Rufname>: <alt> → <neu>“, und der Fokus bleibt auf der Kachel (LLH-1781).
 *
 * Die Wache vor jeder Messung zeigt auf einen Wortlaut, der erst MIT den Daten erscheint. Kein
 * `networkidle` (SSE-Strom).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const SUBPIXEL = 0.5;

const FAHRZEUG_EINHEIT = 'Florian Tableau 1';
const FAHRZEUG_FREI = 'Florian Tableau 2';
const EINHEIT = 'Tableauzug';
const ABSCHNITT = 'EA Tableau';

async function anmelden(page: Page, optionen?: { startseite?: boolean }) {
  await anmeldenPerApi(page, ADMIN, PW, optionen);
}

/** Seeding per `page.request`: die Session ist Cookie-basiert, der Jar wird geteilt. */
async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

async function seede(page: Page): Promise<number> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `FMS-Tableau ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  const abschnittId = await post(page, `${basis}/sectors`, { name: ABSCHNITT });
  const einheitId = await post(page, `${basis}/units`, {
    name: EINHEIT,
    abschnitt_id: abschnittId,
  });
  const efId = await post(page, `${basis}/vehicles`, {
    adhoc: { funkrufname: FAHRZEUG_EINHEIT, fahrzeugtyp: 'LF 20' },
  });
  const zuordnung = await page.request.put(`${basis}/units/${einheitId}/vehicles/${efId}`);
  expect(zuordnung.ok(), `Zuordnung: ${await zuordnung.text()}`).toBeTruthy();
  await post(page, `${basis}/vehicles`, { adhoc: { funkrufname: FAHRZEUG_FREI } });
  return einsatzId;
}

const tableau = (page: Page) => page.getByRole('region', { name: 'FMS-Tableau' });

test('das Tableau läuft auf 390, 1024 und 1366 px nicht waagerecht über', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await seede(page);

  for (const breite of [390, 1024, 1366]) {
    await page.setViewportSize({ width: breite, height: 900 });
    // Über die Sprungmarken-Adresse — die Ansicht ist Zustand der Adresse und bleibt stehen
    // (LLH-1826, `frontend/AGENTS.md`, „Ansicht und Filter gehören in die Adresse“).
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=tableau`);
    await expect(tableau(page).getByRole('heading', { name: ABSCHNITT })).toBeVisible();
    await expect(tableau(page).getByText(FAHRZEUG_FREI)).toBeVisible();
    await expect(page).toHaveURL(/[?&]ansicht=tableau(&|$)/);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        { message: `${breite} px: das Tableau läuft waagerecht über` },
      )
      .toBeLessThanOrEqual(SUBPIXEL);
  }
});

test('eine einzelne Kachel ist bei 1366 px nicht breiter als eine Spalte', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await seede(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=tableau`);
  // Im Abschnitt „EA Tableau“ steht genau ein Fahrzeug (über die Einheit).
  const knopf = tableau(page).getByRole('button', {
    name: `Status von ${FAHRZEUG_EINHEIT} ändern`,
  });
  await expect(knopf).toBeVisible();
  // `auto-fill` hält leere Spuren frei: die Kachel bleibt eine Spalte breit (240 px Boden,
  // bei 1366 px also deutlich unter der halben Zeile), statt sich über die Zeile zu ziehen.
  const kachel = knopf.locator('xpath=ancestor::*[@data-lfh="fms-kachel"][1]');
  const breite = (await kachel.boundingBox())!.width;
  expect(breite, `Kachel ${breite} px`).toBeLessThan(1366 / 2);
});

test('Ziffern setzen den Status der fokussierten Kachel nacheinander, und er übersteht das Neuladen', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await seede(page);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=tableau`);

  const knopf = tableau(page).getByRole('button', {
    name: `Status von ${FAHRZEUG_EINHEIT} ändern`,
  });
  // Startstatus der Disposition: der erste gebundene Katalogeintrag, im Seed „3 – Auf Anfahrt".
  // Die Kachel zeigt die Ziffer groß und das Wort darunter (LLH-1782), ohne „S“.
  await expect(knopf).toHaveText(/^3Auf Anfahrt/);
  await knopf.focus();
  await page.keyboard.press('4');
  await expect(knopf).toHaveText(/^4Am Einsatzort/);
  // Die Quittung steht, ohne den Fokus von der Kachel zu nehmen (Spec
  // `fahrzeugstatus-quittung`, „Zifferntaste im Tableau“).
  await expect(page.getByText(`${FAHRZEUG_EINHEIT}: S3 → S4`)).toBeVisible();

  // Während der Mutation ist der Knopf `disabled`, und der Browser wirft den Fokus auf
  // <body>. Das Tableau gibt ihn zurück — sonst ginge die zweite Ziffer ins Leere.
  await expect(knopf).toBeFocused();
  await page.keyboard.press('5');
  await expect(knopf).toHaveText(/^5\D/);
  await expect(knopf).toBeFocused();

  // Die andere Kachel bleibt unberührt — die Ziffer wirkt nur, wo der Fokus steht.
  await expect(
    tableau(page).getByRole('button', { name: `Status von ${FAHRZEUG_FREI} ändern` }),
  ).toHaveText(/^3Auf Anfahrt/);

  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=tableau`);
  await expect(
    tableau(page).getByRole('button', { name: `Status von ${FAHRZEUG_EINHEIT} ändern` }),
  ).toHaveText(/^5\D/);
});
