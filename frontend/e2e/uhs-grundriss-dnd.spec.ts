import { expect, test, type Page, type Request } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

// Regression LFH-13: Platz-Karte ließ sich im Browser nicht verschieben, weil
// onDragEnd wegen fehlender Drop-Zone unter der freien Layout-Fläche frühzeitig
// returnte. Dieser Test deckt den Maus-Drag und den PATCH-Roundtrip ab.
test('UHS Grundriss: Platz-Karte per Maus verschieben löst genau einen PATCH aus', async ({ page }) => {
  await anmelden(page);

  // Einsatz anlegen — Mutation navigiert nach Erfolg nach /einsaetze/:id/<default-modul>.
  const einsatzName = `E2E UHS DnD ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  // Direkt ins UHS-Modul wechseln.
  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  await expect(page.getByRole('heading', { name: 'Unfallhilfsstellen' })).toBeVisible();

  // UHS anlegen.
  const uhsName = `BHP DnD ${Date.now()}`;
  await page.getByRole('button', { name: 'Neu' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('button', { name: uhsName })).toBeVisible();

  // Detail-Drawer öffnen und auf Grundriss-Tab wechseln.
  await page.getByRole('button', { name: uhsName }).click();
  await page.getByRole('tab', { name: 'Grundriss' }).click();

  // Platz anlegen.
  const platzName = `Bett ${Date.now()}`;
  await page.getByRole('button', { name: '+ Platz' }).click();
  await page.getByPlaceholder('Bezeichnung (z. B. Bett 3)').fill(platzName);
  await page.getByRole('button', { name: 'OK' }).click();

  const karte = page
    .locator('div')
    .filter({ has: page.getByText(platzName, { exact: true }) })
    .filter({ hasText: 'frei' })
    .first();
  await expect(karte).toBeVisible();
  const before = await karte.boundingBox();
  expect(before).not.toBeNull();
  const cx = before!.x + before!.width / 2;
  const cy = before!.y + before!.height / 2;

  // PATCH-Requests an /plaetze/:pid einsammeln — die Mutation darf genau einmal feuern.
  const platzPatchRegex = /\/api\/einsaetze\/\d+\/uhs\/\d+\/plaetze\/\d+(\?.*)?$/;
  const patches: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && platzPatchRegex.test(req.url())) patches.push(req);
  });
  const patchPromise = page.waitForRequest(
    (req) => req.method() === 'PATCH' && platzPatchRegex.test(req.url()),
  );

  // Maus-Drag in mehreren Schritten, damit dnd-kit den 5px-Activation-Constraint nimmt.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 60, { steps: 12 });
  await page.mouse.up();

  const patch = await patchPromise;
  const body = JSON.parse(patch.postData() ?? '{}') as { pos_x?: number; pos_y?: number };
  expect(typeof body.pos_x).toBe('number');
  expect(typeof body.pos_y).toBe('number');
  expect(body.pos_x!).toBeGreaterThan(0);
  expect(body.pos_y!).toBeGreaterThan(0);

  // Karte bleibt sichtbar an neuer Stelle (nicht „springt zurück").
  await expect.poll(async () => (await karte.boundingBox())?.x ?? 0).toBeGreaterThan(before!.x + 20);
  const after = await karte.boundingBox();
  expect(after!.y).toBeGreaterThan(before!.y + 20);

  // Keine Folge-PATCHes (Mutation feuert genau einmal).
  await page.waitForTimeout(500);
  expect(patches).toHaveLength(1);
});
