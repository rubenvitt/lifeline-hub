import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Ablösung, Schichtplan (LLH-1554): Raster mit Aufziehen, Verschieben, Kanten und Personen ziehen,
 * dazu derselbe Ablauf nur mit der Tastatur — gegen den echten Server.
 *
 * Gesät werden die Einheiten „Streife 2“ und „RTW 1“ und die Kräfte „Anna Plan“ und „Ben Plan“
 * (ad hoc, ohne Einheit, also „Verfügbar“). Geprüft wird jeweils, was der Server danach hält:
 * die Zeit eines Blocks liegt auf 5 Minuten und dauert mindestens 10, ein verschobener Block
 * wechselt die Zeile, eine gezogene Person steht im Block.
 *
 * jsdom sieht weder Zeigerzüge noch dnd-kit; deshalb hier.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

interface Block {
  id: number;
  von: string;
  bis: string;
  posten: { art: string; einheit_id?: number | null };
  personen?: { name: string }[] | null;
}

const MIN = 60_000;
const ms = (wire: string) => Date.parse(`${wire.replace(' ', 'T')}Z`);

/** Zeigerzug in Schritten von `von` nach `nach` (Seitenkoordinaten). */
async function zug(page: Page, von: { x: number; y: number }, nach: { x: number; y: number }) {
  await page.mouse.move(von.x, von.y);
  await page.mouse.down();
  await page.mouse.move(nach.x, nach.y, { steps: 12 });
  await page.mouse.up();
}

async function mitte(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}

test('Schichtplan: Block aufziehen, verschieben, Kante ziehen, Person ziehen', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);

  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Schichtplan ${Date.now()}` },
  });
  expect(neu.ok(), `Seeding Einsatz: ${neu.status()}`).toBeTruthy();
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const basis = `/api/einsaetze/${einsatzId}`;
  const sende = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const streife = await sende('einheiten', { name: 'Streife 2' });
  const rtw = await sende('einheiten', { name: 'RTW 1' });
  await sende('personal', { adhoc: { name: 'Anna Plan' } });
  const bloecke = async () => {
    const antwort = await page.request.get(`${basis}/abloesungen/schichtplan`);
    return ((await antwort.json()) as { bloecke: Block[] }).bloecke;
  };

  await page.goto(`/einsaetze/${einsatzId}/abloesung?ansicht=plan`);
  const raster = page.getByRole('region', { name: 'Schichtplan' });
  const spurStreife = raster.locator(
    `[data-raster-zeile="einheit:${streife.id}"] [data-lfh="schichtplan-spur"]`,
  );
  const spurRtw = raster.locator(
    `[data-raster-zeile="einheit:${rtw.id}"] [data-lfh="schichtplan-spur"]`,
  );
  await expect(spurStreife).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Personen zum Einteilen' }).getByText('Anna Plan'),
  ).toBeVisible();

  // ── Aufziehen ──────────────────────────────────────────────────────────────────────────
  const s = await mitte(spurStreife);
  await zug(page, { x: s.b.x + s.b.width * 0.5, y: s.y }, { x: s.b.x + s.b.width * 0.7, y: s.y });
  const block = raster.locator('[data-lfh="schichtplan-block"]');
  await expect(block).toHaveCount(1);
  await expect.poll(async () => (await bloecke()).length).toBe(1);
  const [angelegt] = await bloecke();
  expect(angelegt.posten.einheit_id).toBe(streife.id);
  const dauer = ms(angelegt.bis) - ms(angelegt.von);
  expect(dauer).toBeGreaterThanOrEqual(10 * MIN);
  expect(ms(angelegt.von) % (5 * MIN)).toBe(0);
  expect(ms(angelegt.bis) % (5 * MIN)).toBe(0);
  await expect(block).toHaveAttribute('data-ampel', 'ohne-soll');

  // ── Verschieben in die Zeile des RTW, eine halbe Blockbreite später ───────────────────────
  const k = await mitte(block);
  const r = await mitte(spurRtw);
  await zug(page, { x: k.x, y: k.y }, { x: k.x + k.b.width / 2, y: r.y });
  await expect.poll(async () => (await bloecke())[0].posten.einheit_id).toBe(rtw.id);
  const [verschoben] = await bloecke();
  expect(ms(verschoben.bis) - ms(verschoben.von)).toBe(dauer);
  expect(ms(verschoben.von)).toBeGreaterThan(ms(angelegt.von));

  // ── Rechte Kante ziehen: der Block wird länger ───────────────────────────────────────────
  const imRtw = raster.locator(
    `[data-raster-zeile="einheit:${rtw.id}"] [data-lfh="schichtplan-block"]`,
  );
  await expect(imRtw).toHaveCount(1);
  const kb = (await imRtw.boundingBox())!;
  await zug(
    page,
    { x: kb.x + kb.width - 3, y: kb.y + kb.height / 2 },
    { x: kb.x + kb.width + kb.width / 2, y: kb.y + kb.height / 2 },
  );
  await expect
    .poll(async () => {
      const [b] = await bloecke();
      return ms(b.bis) - ms(b.von);
    })
    .toBeGreaterThan(dauer);
  expect(ms((await bloecke())[0].von)).toBe(ms(verschoben.von));

  // ── Person aus der Seitenleiste auf den Block ziehen ─────────────────────────────────────
  const anna = page.locator('[data-lfh="schichtplan-person"]').filter({ hasText: 'Anna Plan' });
  const a = await mitte(anna);
  const z = await mitte(imRtw);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(async () => (await bloecke())[0].personen?.map((p) => p.name))
    .toEqual(['Anna Plan']);
  await expect(imRtw).toContainText('Anna Plan');
});

test('Schichtplan: derselbe Ablauf nur mit der Tastatur', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);

  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Schichtplan Tastatur ${Date.now()}` },
  });
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const basis = `/api/einsaetze/${einsatzId}`;
  const sende = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const streife = await sende('einheiten', { name: 'Streife 3' });
  const uhs = await sende('uhs', { bezeichnung: 'UHS Markt', typ: 'behandlungsplatz' });
  await sende('personal', { adhoc: { name: 'Ben Plan' } });
  const bloecke = async () => {
    const antwort = await page.request.get(`${basis}/abloesungen/schichtplan`);
    return ((await antwort.json()) as { bloecke: Block[] }).bloecke;
  };

  await page.goto(`/einsaetze/${einsatzId}/abloesung?ansicht=plan`);
  await expect(page.getByRole('region', { name: 'Schichtplan' })).toBeVisible();

  // ── Anlegen: „Block anlegen“ per Tab erreichen ───────────────────────────────────────────
  const anlegen = page.getByRole('button', { name: 'Block anlegen' });
  await anlegen.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Block anlegen' });
  await expect(dialog).toBeVisible();
  // Fokus steht im ersten Feld (Posten).
  await page.keyboard.type('Streife 3');
  await page.keyboard.press('Enter');
  // Zwischen den Feldern liegt je ein Kalenderknopf; die Felder direkt fassen statt Tab zu zählen.
  await dialog.getByRole('textbox', { name: 'Beginn' }).focus();
  await page.keyboard.type('2300');
  await dialog.getByRole('textbox', { name: 'Ende' }).focus();
  await page.keyboard.type('2330');
  await dialog.getByRole('combobox', { name: 'Personen' }).focus();
  await page.keyboard.type('Ben');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Block anlegen' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await bloecke()).length).toBe(1);
  const [angelegt] = await bloecke();
  expect(angelegt.posten.einheit_id).toBe(streife.id);
  expect(ms(angelegt.bis) - ms(angelegt.von)).toBe(30 * MIN);
  expect(angelegt.personen?.map((p) => p.name)).toEqual(['Ben Plan']);

  // ── Verschieben: Block per Tab fassen, im Dialog Posten und Ende ändern ─────────────────
  await page.getByRole('radio', { name: 'Einsatz' }).click();
  const block = page.locator('[data-lfh="schichtplan-block"]');
  await block.focus();
  await page.keyboard.press('Enter');
  const bearbeiten = page.getByRole('dialog', { name: 'Block Streife 3' });
  await expect(bearbeiten).toBeVisible();
  await page.keyboard.type('UHS Markt');
  await page.keyboard.press('Enter');
  const ende = bearbeiten.getByRole('textbox', { name: 'Ende' });
  await ende.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('2345');
  await bearbeiten.getByRole('button', { name: 'Speichern' }).focus();
  await page.keyboard.press('Enter');
  await expect(bearbeiten).toBeHidden();
  await expect.poll(async () => (await bloecke())[0].posten.art).toBe('uhs');
  const [geaendert] = await bloecke();
  expect(ms(geaendert.bis) - ms(geaendert.von)).toBe(45 * MIN);
  expect(geaendert.personen?.map((p) => p.name)).toEqual(['Ben Plan']);
  expect(uhs.id).toBeGreaterThan(0);
});
