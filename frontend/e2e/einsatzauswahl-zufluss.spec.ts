import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Kein Sprung unter Zeiger und Fokus, wenn woanders ein Einsatz entsteht (LLH-1204,
 * `frontend/AGENTS.md`, „Layout und Live“; Kriterium 12 der Prüfliste Einsatztauglichkeit).
 *
 * Die Einsatzübersicht sortiert den jüngsten Einsatz nach vorn. Legt jemand anderes einen an, lädt
 * das Org-Ereignis `einsatzliste` die Liste neu. Ohne Schleuse rückte jede Kachel eine Stelle
 * weiter, und der Zeiger stünde auf der Nachbarkachel. Gemessen wird deshalb im Browser: die Lage
 * der Kacheln vor und nach dem Neuabruf und welche Kachel unter dem Zeiger liegt.
 *
 * STÖRPROBE (Muster `hervorhebung-bedientext-kontrast.spec.ts`): der Störer wird per API angelegt,
 * während Zeiger oder Fokus stehen. Gewartet wird nicht auf eine Frist, sondern darauf, dass die
 * Seite eine Liste MIT dem Störer abgeholt und gezeichnet hat; sonst wäre „nichts hat sich bewegt"
 * auch grün, wenn der Neuabruf nie kam.
 *
 * Interzipiert wird nur `GET /api/einsaetze`, und nur, um die Einsätze paralleler Tests
 * wegzufiltern (Präfix je Test); die Antwort bleibt die echte des Servers.
 */

const FUEKW = { width: 1366, height: 768 };

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatz(page: Page, bezeichnung: string, begonnen_at?: string): Promise<number> {
  const r = await page.request.post('/api/einsaetze', { data: { bezeichnung, begonnen_at } });
  expect(r.ok(), `Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).id;
}

/** Vor `stunden` Stunden als UTC-Zeitpunkt: legt die Folge der Kacheln fest. */
const vor = (stunden: number) => new Date(Date.now() - stunden * 3_600_000).toISOString();

/**
 * Die Übersicht zeigt nur die Einsätze dieses Tests. `gelesen` sammelt die IDs jeder Liste, die
 * die Seite abgeholt hat, damit die Störprobe auf den Neuabruf warten kann.
 */
async function nurDieseEinsaetze(page: Page, praefix: string, gelesen: Set<number>) {
  await page.route(/\/api\/einsaetze(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const antwort = await route.fetch();
    const liste = (await antwort.json()) as { id: number; bezeichnung: string }[];
    await route.fulfill({
      response: antwort,
      json: liste.filter((e) => e.bezeichnung.startsWith(praefix)),
    });
    liste.forEach((e) => gelesen.add(e.id));
  });
}

/** Wartet, bis die Seite eine Liste mit `id` abgeholt und zwei Bilder gezeichnet hat. */
async function neuabrufGezeichnet(page: Page, gelesen: Set<number>, id: number) {
  await expect
    .poll(() => gelesen.has(id), { message: 'Liste mit dem Störer neu abgerufen' })
    .toBe(true);
  await page.evaluate(
    () => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))),
  );
}

/** Die Bezeichnung der Kachel, die an diesem Punkt liegt. */
async function kachelAm(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) =>
      document.elementFromPoint(px, py)?.closest('[data-lfh="einsatzkachel"]')?.querySelector('a')
        ?.textContent ?? null,
    [x, y] as const,
  );
}

const titelImRaster = (page: Page) => page.getByTestId('einsaetze-raster').getByRole('link');

async function kasten(ort: Locator) {
  const k = await ort.boundingBox();
  expect(k, 'Kachel nicht messbar').not.toBeNull();
  return k!;
}

test('Zeiger: ein woanders angelegter Einsatz verschiebt keine Kachel, wartet im Banner und sortiert sich beim Verlassen ein', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const praefix = `E2E 1204 Zeiger ${Date.now()}`;
  await einsatz(page, `${praefix} A`, vor(2));
  await einsatz(page, `${praefix} B`, vor(1));
  const gelesen = new Set<number>();
  await nurDieseEinsaetze(page, praefix, gelesen);
  await page.goto('/einsaetze');
  await expect(titelImRaster(page)).toHaveText([`${praefix} B`, `${praefix} A`]);

  const kachel = (name: string) =>
    page.locator('[data-lfh="einsatzkachel"]', { hasText: `${praefix} ${name}` });
  const vorherA = await kasten(kachel('A'));
  const vorherB = await kasten(kachel('B'));
  // Der Zeiger zielt auf B, die vorderste Einsatzkachel: genau die rückte ohne Schleuse weiter.
  const x = vorherB.x + vorherB.width / 2;
  const y = vorherB.y + vorherB.height / 2;
  await page.mouse.move(x, y, { steps: 3 });
  expect(await kachelAm(page, x, y)).toBe(`${praefix} B`);

  const stoerer = await einsatz(page, `${praefix} Störer`);
  await neuabrufGezeichnet(page, gelesen, stoerer);

  await expect(page.getByRole('status').filter({ hasText: '1 neuer Einsatz' })).toBeVisible();
  await expect(titelImRaster(page)).toHaveText([`${praefix} B`, `${praefix} A`]);
  expect(await kasten(kachel('A')), 'Kachel A nach dem Störer').toEqual(vorherA);
  expect(await kasten(kachel('B')), 'Kachel B nach dem Störer').toEqual(vorherB);
  expect(await kachelAm(page, x, y), 'unter dem Zeiger nach dem Störer').toBe(`${praefix} B`);

  // Verlassen Zeiger und Fokus den Bereich, steht der neue Einsatz vorn, der Banner ist weg.
  await page.mouse.move(0, 0);
  await expect(titelImRaster(page)).toHaveText([
    `${praefix} Störer`,
    `${praefix} B`,
    `${praefix} A`,
  ]);
  await expect(page.getByText('1 neuer Einsatz')).toHaveCount(0);
});

test('Fokus: die fokussierte Kachel bleibt stehen; „anzeigen" holt den neuen Einsatz und fokussiert ihn', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const praefix = `E2E 1204 Fokus ${Date.now()}`;
  await einsatz(page, `${praefix} A`, vor(2));
  await einsatz(page, `${praefix} B`, vor(1));
  const gelesen = new Set<number>();
  await nurDieseEinsaetze(page, praefix, gelesen);
  await page.goto('/einsaetze');
  await expect(titelImRaster(page)).toHaveText([`${praefix} B`, `${praefix} A`]);
  // Kein Zeiger über der Seite: allein der Fokus hält.
  await page.mouse.move(0, 0);

  const linkB = page.getByRole('link', { name: `${praefix} B`, exact: true });
  await linkB.focus();
  const vorherB = await kasten(linkB);

  const stoerer = await einsatz(page, `${praefix} Störer`);
  await neuabrufGezeichnet(page, gelesen, stoerer);

  await expect(page.getByRole('status').filter({ hasText: '1 neuer Einsatz' })).toBeVisible();
  await expect(titelImRaster(page)).toHaveText([`${praefix} B`, `${praefix} A`]);
  expect(await kasten(linkB), 'fokussierte Kachel nach dem Störer').toEqual(vorherB);
  await expect(linkB).toBeFocused();

  // Per Tastatur zum Banner: der Weg dorthin bleibt im Bereich und taut nicht auf.
  const anzeigen = page.getByRole('button', { name: 'anzeigen' });
  await anzeigen.focus();
  await expect(titelImRaster(page)).toHaveText([`${praefix} B`, `${praefix} A`]);
  await page.keyboard.press('Enter');

  await expect(titelImRaster(page)).toHaveText([
    `${praefix} Störer`,
    `${praefix} B`,
    `${praefix} A`,
  ]);
  await expect(page.getByText('1 neuer Einsatz')).toHaveCount(0);
  // Der Knopf ist mit dem Banner weg; der Fokus steht auf dem neuen Einsatz, nicht auf `body`.
  await expect(page.getByRole('link', { name: `${praefix} Störer`, exact: true })).toBeFocused();
});
