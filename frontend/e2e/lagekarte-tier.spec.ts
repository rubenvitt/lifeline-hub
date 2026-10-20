import { expect, test, type Page } from '@playwright/test';

// Tiere auf der Lagekarte (LLH-1123) — Durchstich im echten Renderer: kommt der Platziermodus aus
// der Tier-Detailseite an, landet das Tier als Kreis mit „T“ in der Marker-Quelle, schreibt die
// Verortung kein ETB, führt „Zurück zu …“ auf die Detailseite, und fehlt die Ebene, sobald das
// Modul Tiere ausgeblendet ist? Geprüft wird die Quelle (`querySourceFeatures`), nicht die Pixel.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

async function anmeldenAls(page: Page, benutzer: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden(
  page: Page,
  methode: 'post' | 'patch' | 'put',
  pfad: string,
  data?: unknown,
): Promise<{ id: number }> {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as { id: number };
}

async function tierFeature(page: Page, id: number): Promise<Record<string, unknown> | undefined> {
  const alle = await page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    if (!k || !k.loaded()) return [];
    return k.querySourceFeatures('marker-cluster').map((f) => f.properties ?? {});
  });
  return alle.find((p) => p.schluessel === `tier-${id}`);
}

async function karteBereit(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
}

async function springe(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ({ c, z }) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({ center: c, zoom: z }),
    { c: center, z: zoom },
  );
}

async function klickeAuf(page: Page, ll: [number, number]) {
  const p = await page.evaluate((c) => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const px = k.project(c);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: r.left + px.x, y: r.top + px.y };
  }, ll);
  await page.mouse.click(p.x, p.y);
}

async function countEtb(page: Page, basis: string): Promise<number> {
  return ((await (await page.request.get(`${basis}/etb`)).json()) as unknown[]).length;
}

const ORT: [number, number] = [9.356, 52.103];
const FUND_ORT: [number, number] = [9.362, 52.106];
const VERMISST_ORT: [number, number] = [9.366, 52.109];

test.use({ viewport: { width: 1366, height: 768 } });

test('Tier: aus der Detailseite verorten, Kreis mit „T“, ohne ETB, zurück zur Detailseite', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Tiere ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: hund } = await senden(page, 'post', `${basis}/tiere`, {
    spezies: 'hund',
    rufname: 'Bello',
  });
  // Ein vermisstes Tier, schon beim Anlegen verortet: Achtung und das Wort „vermisst“.
  const { id: katze } = await senden(page, 'post', `${basis}/tiere`, {
    spezies: 'katze',
    status: 'vermisst',
    antreff_lat: VERMISST_ORT[1],
    antreff_lon: VERMISST_ORT[0],
  });

  // Einstieg am Feld „Verortung“ der Detailseite.
  await page.goto(`/einsaetze/${e}/tiere/${hund}`);
  await expect(page.getByText('nicht verortet')).toBeVisible();
  const etbVorher = await countEtb(page, basis);
  await page.getByRole('button', { name: 'Auf Karte verorten' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/lagekarte`));
  await karteBereit(page);
  await expect(page.locator('[data-lfh="kartenspalte"]')).toHaveClass(/lfh-karte-setzen/);
  // apply-then-clean: der Auftrag ist aus der Adresse verschwunden.
  await expect(page).not.toHaveURL(/platzieren=/);
  await springe(page, FUND_ORT, 15);
  await klickeAuf(page, FUND_ORT);

  await expect.poll(() => tierFeature(page, hund), { timeout: 30_000 }).toBeDefined();
  const f = await tierFeature(page, hund);
  expect(f?.kurzzeichen).toBe('T');
  expect(f?.beschriftung).toBe('T-001 (Hund)');
  // Kein Eigenbau-Zeichen: DV 102 kennt kein Tier ohne Zustand, der Marker bleibt ein Kreis.
  expect(f?.icon).toBeUndefined();
  // Kein ETB-Eintrag für die Verortung.
  expect(await countEtb(page, basis)).toBe(etbVorher);

  // Das vermisste Tier trägt das Wort als zweiten Kanal.
  await springe(page, VERMISST_ORT, 15);
  await expect
    .poll(async () => (await tierFeature(page, katze))?.beschriftung, { timeout: 30_000 })
    .toBe('T-002 (Katze) · vermisst');

  // „Zurück zu …“ führt auf die Detailseite, die nun die Koordinate zeigt.
  await page.getByRole('button', { name: 'Zurück zu T-001 (Hund)' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/tiere/${hund}$`));
  await expect(page.getByRole('button', { name: 'Auf Karte versetzen' })).toBeVisible();
  await expect(page.getByText('nicht verortet')).toHaveCount(0);
});

test('Tier: ohne Modul Tiere keine Ebene und kein Marker', async ({ page }) => {
  test.setTimeout(120_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Tiere gesperrt ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: hund } = await senden(page, 'post', `${basis}/tiere`, {
    spezies: 'hund',
    antreff_lat: FUND_ORT[1],
    antreff_lon: FUND_ORT[0],
  });

  // Gegenprobe: mit Modul steht die Zeile da und der Marker in der Quelle.
  await page.goto(`/einsaetze/${e}/lagekarte`);
  await karteBereit(page);
  await springe(page, FUND_ORT, 15);
  await expect.poll(() => tierFeature(page, hund), { timeout: 30_000 }).toBeDefined();
  await expect(page.locator('[data-ebene="tier"]')).toHaveCount(1, { timeout: 30_000 });

  await senden(page, 'put', `${basis}/modul-overrides/tiere`, {
    sichtbar: false,
    benoetigte_rolle: null,
  });
  await page.reload();
  await karteBereit(page);
  await springe(page, FUND_ORT, 15);
  // Die Zeile der Einheiten steht, die der Tiere fehlt: ausgeblendet heißt keine Zeile.
  await expect(page.locator('[data-ebene="einheit"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('[data-ebene="tier"]')).toHaveCount(0);
  expect(await tierFeature(page, hund)).toBeUndefined();
});
