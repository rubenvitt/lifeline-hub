import { expect, test, type Page, type Request } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

// Eine Platz-Karte lässt sich per Maus verschieben, und die Layout-Mutation feuert genau
// einen PATCH (pos_x/pos_y) — früher kehrte `onDragEnd` mangels Drop-Zone unter der freien
// Fläche früh zurück (LFH-13). Eine frisch angelegte UHS ist `geplant`, der Bearbeiten-Modus
// (Karten ziehbar) ist damit aktiv.
test('UHS Grundriss: Platz-Karte per Maus verschieben löst genau einen PATCH aus', async ({
  page,
}) => {
  await anmelden(page);

  // Einsatz anlegen — Mutation navigiert nach Erfolg nach /einsaetze/:id/<default-modul>.
  const einsatzName = `E2E UHS DnD ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  // Direkt ins UHS-Modul; frischer Einsatz → Leerzustand mit „Erste UHS anlegen".
  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  const uhsName = `BHP DnD ${Date.now()}`;
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();

  // Detail öffnen — der Grundriss wird direkt angezeigt.
  await page.getByRole('button', { name: uhsName }).click();

  // Einen Platz anlegen (Vorgabe „Bett", Menge 1 → „Bett 1"); die Bezeichnung vergibt der Server.
  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();

  const karte = page.locator('[data-testid="platz-karte"]', { hasText: 'Bett 1' });
  await expect(karte).toBeVisible();
  const before = await karte.boundingBox();
  expect(before).not.toBeNull();
  // Nahe der Kartenoberkante (Titel) greifen — nicht die Kartenmitte, damit der Drag nicht
  // den Aktions-Buttons (onPointerDown stopPropagation) in die Quere kommt.
  const cx = before!.x + before!.width / 2;
  const cy = before!.y + 14;

  // PATCH-Requests an /plaetze/:pid einsammeln — die Layout-Mutation darf genau einmal feuern.
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
  await expect
    .poll(async () => (await karte.boundingBox())?.x ?? 0)
    .toBeGreaterThan(before!.x + 20);
  const after = await karte.boundingBox();
  expect(after!.y).toBeGreaterThan(before!.y + 20);

  // Keine Folge-PATCHes (Mutation feuert genau einmal).
  await page.waitForTimeout(500);
  expect(patches).toHaveLength(1);
});
