import { expect, test, type Page } from '@playwright/test';
import { anmeldenPerApi } from './anmelde-kern';
import { ladeInDichte, SUBPIXEL } from './trefflaeche-kern';

/**
 * Statusmenü der Fahrzeuge im echten Browser (LLH-1781, Spec `fahrzeugstatus-quittung`,
 * „Das Statusmenü liegt ganz im Fenster“): Lage, Höhe und Spalten rechnet `menueLage` in
 * `components/StatusWahl.tsx`; ob das Menü wirklich im Fenster steht, zeigt nur der Browser.
 *
 *  1. Tablet 1024 × 768, oberste Zeile: der erste Eintrag beginnt im Fenster, und das Menü ist
 *     beim Öffnen nicht weggerollt.
 *  2. Handschuh 1366 × 520: alle Einträge (bis S9 und S0) stehen ohne Rollen im Fenster, das
 *     Menü mehrspaltig (zwei Spalten, oder drei, wenn auch zwei nicht passen).
 *  3. Nach dem Wechsel steht die Quittung „<Rufname>: <alt> → <neu>“ mit „Rückgängig“, und
 *     „Rückgängig“ stellt den alten Status her (echter Server, Spec „Statuswechsel zurücknehmen“).
 *
 * NUR DIE FMS-STATUS (LLH-2003): Der Fahrzeugstatus-Katalog gilt für die ganze Organisation, und
 * andere Specs im selben Backend legen darin Status an (`kraefte-kontrast.spec.ts` je Lauf und
 * Modus mehrere, mit `sortier` 0, also VOR S1). Das Menü hatte dann 16 bis 28 statt 10 Einträgen,
 * der erste war nicht S1, und beide Fälle maßen eine Kataloglänge, um die es in der Spec nicht
 * geht. Fall 1 und 2 zeigen deshalb nur die Einträge mit FMS-Anker (S1 bis S9, S0), wie die
 * Szenarien der Spec sie nennen; die Grenzen selbst bleiben.
 *
 * Kein `networkidle` (SSE-Strom), gewartet wird auf Inhaltsanker.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const RUFNAME = 'Florian Menü 1';

async function seede(page: Page): Promise<number> {
  const einsatz = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Statusmenü ${Date.now()}` },
  });
  expect(einsatz.ok(), `Einsatz: ${await einsatz.text()}`).toBeTruthy();
  const einsatzId = ((await einsatz.json()) as { id: number }).id;
  const fahrzeug = await page.request.post(`/api/einsaetze/${einsatzId}/vehicles`, {
    data: { adhoc: { funkrufname: RUFNAME, fahrzeugtyp: 'RTW' } },
  });
  expect(fahrzeug.ok(), `Fahrzeug: ${await fahrzeug.text()}`).toBeTruthy();
  return einsatzId;
}

const knopf = (page: Page) => page.getByRole('button', { name: `Status von ${RUFNAME} ändern` });
const menue = (page: Page) => page.getByRole('menu', { name: `Status von ${RUFNAME}` });

/**
 * Der Katalog zeigt nur Einträge mit FMS-Anker (S1 bis S9, S0), nicht die, die andere Specs im
 * selben Backend angelegt haben (siehe Kopf).
 */
async function nurFmsStatus(page: Page) {
  await page.route('**/api/vehicle-statuses', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const antwort = await route.fetch();
    const katalog = (await antwort.json()) as { fms_anker: number | null }[];
    await route.fulfill({ response: antwort, json: katalog.filter((s) => s.fms_anker != null) });
  });
}

/** Ober- und Unterkante jedes Menüeintrags gegen das Fenster. */
async function eintraegeImFenster(page: Page) {
  const eintraege = menue(page).getByRole('menuitem');
  const anzahl = await eintraege.count();
  expect(anzahl, 'das Menü hat Einträge').toBeGreaterThan(1);
  const hoehe = page.viewportSize()!.height;
  const lagen: { text: string; oben: number; unten: number }[] = [];
  for (let i = 0; i < anzahl; i++) {
    const kasten = (await eintraege.nth(i).boundingBox())!;
    lagen.push({
      text: (await eintraege.nth(i).innerText()).trim(),
      oben: kasten.y,
      unten: kasten.y + kasten.height,
    });
  }
  return { lagen, hoehe };
}

test('Tablet 1024 × 768: das Statusmenü der obersten Zeile beginnt mit dem ersten Eintrag im Fenster', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, PW, { startseite: false });
  await page.setViewportSize({ width: 1024, height: 768 });
  const einsatzId = await seede(page);
  await nurFmsStatus(page);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
  await knopf(page).click();
  await expect(menue(page)).toBeVisible();
  // Der Kopf nennt das Fahrzeug und ist kein Eintrag.
  await expect(menue(page).getByText(RUFNAME, { exact: true })).toBeVisible();

  // Erst messen, wenn die Einblendung steht: im Takt `appear-start` ist das Menü auf null
  // gestaucht (siehe `kraefte-kontrast.spec.ts`, LFH-536).
  await expect(page.locator('.ant-dropdown').filter({ has: menue(page) })).not.toHaveClass(
    /ant-slide-(up|down)-appear/,
  );
  // Vorbedingung: genau die zehn FMS-Status, um die es geht.
  await expect(menue(page).getByRole('menuitem')).toHaveCount(10);

  const { lagen, hoehe } = await eintraegeImFenster(page);
  expect(lagen[0].text, 'der erste Eintrag ist S1').toMatch(/^S1\b/);
  expect(
    lagen[0].oben,
    `erster Eintrag „${lagen[0].text}“ beginnt im Fenster`,
  ).toBeGreaterThanOrEqual(-SUBPIXEL);
  for (const l of lagen) {
    expect(l.oben, `„${l.text}“ beginnt im Fenster`).toBeGreaterThanOrEqual(-SUBPIXEL);
    expect(l.oben, `„${l.text}“ beginnt im Fenster`).toBeLessThan(hoehe);
  }
  // Nicht weggerollt (LLH-2003): ein scrollender Fokus beim Öffnen rollte ein langes Menü nach
  // unten. Die Ursache hält `StatusWahl.test.tsx` fest, hier steht die Wirkung.
  const gerollt = await menue(page).evaluate((m) => m.scrollTop);
  expect(gerollt, 'das Menü ist beim Öffnen nicht weggerollt').toBeLessThanOrEqual(SUBPIXEL);
});

test('Handschuh 1366 × 520: alle Statuswerte stehen ohne Rollen im Fenster, das Menü mehrspaltig', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, PW, { startseite: false });
  await page.setViewportSize({ width: 1366, height: 520 });
  const einsatzId = await seede(page);
  await nurFmsStatus(page);
  await ladeInDichte(page, `/einsaetze/${einsatzId}/fahrzeuge`, 'handschuh');
  await knopf(page).click();
  await expect(menue(page)).toBeVisible();
  await expect(page.locator('.ant-dropdown').filter({ has: menue(page) })).not.toHaveClass(
    /ant-slide-(up|down)-appear/,
  );
  // Vorbedingung: genau die zehn FMS-Status, um die es geht.
  await expect(menue(page).getByRole('menuitem')).toHaveCount(10);

  const { lagen, hoehe } = await eintraegeImFenster(page);
  for (const l of lagen) {
    expect(l.oben, `„${l.text}“ beginnt im Fenster`).toBeGreaterThanOrEqual(-SUBPIXEL);
    expect(l.unten, `„${l.text}“ endet im Fenster`).toBeLessThanOrEqual(hoehe + SUBPIXEL);
  }
  // Mehrspaltig: mindestens zwei Einträge teilen sich eine Zeile.
  const zeilen = new Set(lagen.map((l) => Math.round(l.oben)));
  expect(zeilen.size, 'Einträge stehen in mehreren Spalten').toBeLessThan(lagen.length);
  // Ohne Rollen: das Menü rollt nicht.
  const rollt = await menue(page).evaluate((m) => m.scrollHeight - m.clientHeight);
  expect(rollt, 'das Menü rollt nicht').toBeLessThanOrEqual(SUBPIXEL);
});

test('nach dem Wechsel steht die Quittung, und „Rückgängig“ stellt den alten Status her', async ({
  page,
}) => {
  await anmeldenPerApi(page, ADMIN, PW, { startseite: false });
  const einsatzId = await seede(page);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
  // Startstatus der Disposition: der erste gebundene Katalogeintrag, im Seed S3.
  await expect(knopf(page)).toContainText('S3');
  await knopf(page).click();
  await menue(page)
    .getByRole('menuitem', { name: /Am Einsatzort/ })
    .click();
  await expect(knopf(page)).toContainText('S4');

  const quittung = page.getByText(`${RUFNAME}: S3 → S4`);
  await expect(quittung).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(knopf(page)).toContainText('S3');

  // Der Server hat zurückgenommen: das Neuladen zeigt S3.
  await page.reload();
  await expect(knopf(page)).toContainText('S3');
});

test('Personal: nach dem Wechsel steht die Quittung, und „Rückgängig“ stellt den alten Status her (LLH-1986)', async ({
  page,
}) => {
  const NAME = 'Anna Quittung';
  await anmeldenPerApi(page, ADMIN, PW, { startseite: false });
  const einsatz = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Statusquittung ${Date.now()}` },
  });
  expect(einsatz.ok(), `Einsatz: ${await einsatz.text()}`).toBeTruthy();
  const einsatzId = ((await einsatz.json()) as { id: number }).id;
  const kraft = await page.request.post(`/api/einsaetze/${einsatzId}/personnel`, {
    data: { adhoc: { name: NAME } },
  });
  expect(kraft.ok(), `Kraft: ${await kraft.text()}`).toBeTruthy();

  await page.goto(`/einsaetze/${einsatzId}/personal`);
  const statusKnopf = page.getByRole('button', { name: `Status von ${NAME} ändern` });
  // Startstatus der Disposition: der erste gebundene Katalogeintrag, im Seed „alarmiert“.
  await expect(statusKnopf).toContainText('alarmiert');
  await statusKnopf.click();
  await page.getByRole('menuitem', { name: 'im Einsatz' }).click();
  await expect(statusKnopf).toContainText('im Einsatz');

  await expect(page.getByText(`${NAME}: alarmiert → im Einsatz`)).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(statusKnopf).toContainText('alarmiert');
  await page.reload();
  await expect(statusKnopf).toContainText('alarmiert');
});
