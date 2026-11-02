import { expect, test, type Page } from '@playwright/test';
import { oeffneEbenenGruppe } from './leisten-kern';

// Sammelstellen der Evakuierungsbezirke auf der Lagekarte (LLH-1393) — Durchstich im echten
// Renderer: steht die verortete Sammelstelle mit dem Zeichen „Sammelplatz für Betroffene“ in der
// Marker-Quelle, wählt `?evakuierungsbezirk=` sie bei einem Bezirk ohne Fläche, setzt der
// Platziermodus nur ihre Koordinate (ohne ETB, der Freitext bleibt), und fehlt die Ebene, sobald
// das Modul Evakuierung ausgeblendet ist? Geprüft wird die Quelle (`querySourceFeatures`), nicht
// die Pixel.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

interface Bezirk {
  id: number;
  sammelstelle?: string | null;
  sammelstelle_lat?: number | null;
  sammelstelle_lon?: number | null;
}

async function anmeldenAls(page: Page, benutzer: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch' | 'put',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

async function sammelstelleFeature(
  page: Page,
  id: number,
): Promise<Record<string, unknown> | undefined> {
  const alle = await page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    if (!k || !k.loaded()) return [];
    return k.querySourceFeatures('marker-cluster').map((f) => f.properties ?? {});
  });
  return alle.find((p) => p.schluessel === `sammelstelle-${id}`);
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

async function bezirkLaden(page: Page, basis: string, id: number): Promise<Bezirk | undefined> {
  const antwort = await page.request.get(`${basis}/evakuierung`);
  const { bezirke } = (await antwort.json()) as { bezirke: Bezirk[] };
  return bezirke.find((b) => b.id === id);
}

const ORT: [number, number] = [9.356, 52.103];
const SAMMEL_ORT: [number, number] = [9.362, 52.106];
const NEU_ORT: [number, number] = [9.366, 52.109];

test.use({ viewport: { width: 1366, height: 768 } });

test('Sammelstelle: Zeichen, Sprung vom Bezirk ohne Fläche, Setzen ohne ETB', async ({ page }) => {
  test.setTimeout(180_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Sammelstelle ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: nord } = await senden(page, 'post', `${basis}/evakuierung/bezirke`, {
    bezeichnung: 'Nord',
    plan_personen: 120,
    plan_erhebung: 'geschaetzt',
    sammelstelle: 'Parkplatz Sporthalle',
    sammelstelle_lat: SAMMEL_ORT[1],
    sammelstelle_lon: SAMMEL_ORT[0],
  });
  const { id: sued } = await senden(page, 'post', `${basis}/evakuierung/bezirke`, {
    bezeichnung: 'Süd',
    plan_personen: 80,
    plan_erhebung: 'geschaetzt',
    sammelstelle: 'Schule',
  });

  // Bezirk ohne Fläche: der Sprung wählt die Sammelstelle und räumt den Parameter.
  await page.goto(`/einsaetze/${e}/lagekarte?evakuierungsbezirk=${nord}`);
  await karteBereit(page);
  await expect(page).not.toHaveURL(/evakuierungsbezirk=/);
  await expect(page.getByText('Sammelstelle · Parkplatz Sporthalle')).toBeVisible({
    timeout: 30_000,
  });
  await springe(page, SAMMEL_ORT, 15);
  await expect.poll(() => sammelstelleFeature(page, nord), { timeout: 30_000 }).toBeDefined();
  const f = await sammelstelleFeature(page, nord);
  expect(f?.beschriftung).toBe('Sammelstelle Nord');
  // Stelle mit der Marke F.3.12, kein Kreis mit Kurzzeichen; Tag- oder Nachtbild (LLH-1141).
  expect(String(f?.icon)).toMatch(/^ez\|(dark\|)?.*circle-double-arrow-lower-v.*circle-12/);
  expect(f?.kurzzeichen).toBeUndefined();

  // Die Sammelstelle ohne Punkt: der Platziermodus setzt nur ihre Koordinate, ohne ETB.
  const etbVorher = await countEtb(page, basis);
  await page.goto(`/einsaetze/${e}/lagekarte?platzieren=sammelstelle:${sued}`);
  await karteBereit(page);
  await expect(page.locator('[data-lfh="kartenspalte"]')).toHaveClass(/lfh-karte-setzen/);
  await expect(page).not.toHaveURL(/platzieren=/);
  await springe(page, NEU_ORT, 15);
  await klickeAuf(page, NEU_ORT);
  await expect.poll(() => sammelstelleFeature(page, sued), { timeout: 30_000 }).toBeDefined();
  expect((await sammelstelleFeature(page, sued))?.beschriftung).toBe('Sammelstelle Süd');
  const b = await bezirkLaden(page, basis, sued);
  expect(b?.sammelstelle).toBe('Schule');
  expect(b?.sammelstelle_lat).toBeCloseTo(NEU_ORT[1], 3);
  expect(b?.sammelstelle_lon).toBeCloseTo(NEU_ORT[0], 3);
  expect(await countEtb(page, basis)).toBe(etbVorher);
});

test('Sammelstelle: ohne Modul Evakuierung keine Ebene und kein Marker', async ({ page }) => {
  test.setTimeout(120_000);
  const LAUF = Date.now();
  await anmeldenAls(page, ADMIN, PW);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Sammelstelle gesperrt ${LAUF}`,
  });
  const basis = `/api/einsaetze/${e}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  const { id: nord } = await senden(page, 'post', `${basis}/evakuierung/bezirke`, {
    bezeichnung: 'Nord',
    plan_personen: 120,
    plan_erhebung: 'geschaetzt',
    sammelstelle: 'Parkplatz Sporthalle',
    sammelstelle_lat: SAMMEL_ORT[1],
    sammelstelle_lon: SAMMEL_ORT[0],
  });

  // Gegenprobe: mit Modul steht die Zeile da und der Marker in der Quelle.
  await page.goto(`/einsaetze/${e}/lagekarte`);
  await karteBereit(page);
  await springe(page, SAMMEL_ORT, 15);
  await expect.poll(() => sammelstelleFeature(page, nord), { timeout: 30_000 }).toBeDefined();
  await oeffneEbenenGruppe(page, 'betroffene');
  await expect(page.locator('[data-ebene="sammelstelle"]')).toHaveCount(1, { timeout: 30_000 });

  await senden(page, 'put', `${basis}/modul-overrides/evakuierung`, {
    sichtbar: false,
    benoetigte_rolle: null,
  });
  await page.reload();
  await karteBereit(page);
  await springe(page, SAMMEL_ORT, 15);
  await expect(page.locator('[data-ebene="einheit"]')).toHaveCount(1, { timeout: 30_000 });
  // Die Gruppe steht noch und ist offen — sonst wäre die Abwesenheit geschenkt.
  await oeffneEbenenGruppe(page, 'betroffene');
  await expect(page.locator('[data-ebene="uhs"]')).toHaveCount(1);
  await expect(page.locator('[data-ebene="sammelstelle"]')).toHaveCount(0);
  expect(await sammelstelleFeature(page, nord)).toBeUndefined();
});
