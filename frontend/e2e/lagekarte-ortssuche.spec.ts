import { expect, test, type Page } from '@playwright/test';

// Ortssuche der Lagekarte im Browser (LFH-638, Spec `lagekarte-ortssuche`): Koordinate tippen →
// anfliegen → Suchnadel; Adresse auf Enter mit Direktflug; `?ort=` am Handschirm; und ein Tipp auf
// einen Marker UNTER der Nadel wählt den Marker (die Nadel ist keine Klickebene).
//
// Der Geocoder wird nie gefragt: die Adresssuche fängt `page.route` am Frontend ab. Damit hängt die
// Spec nicht am Netz, und ein echter Nominatim bekäme keine Testlast.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  isMoving(): boolean;
  getCenter(): { lng: number; lat: number };
  getCanvas(): HTMLCanvasElement;
  project(ll: [number, number]): { x: number; y: number };
  querySourceFeatures(id: string): Array<{ geometry: { coordinates?: unknown } }>;
}

/** Ein einzelnes Fahrzeug abseits, damit es als WebGL-Einzelzeichen steht, nicht im Cluster. */
const PUMPE: [number, number] = [8.81, 53.0775];

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/** Einsatz mit einer verorteten Einheit. Kein Modulname im Einsatznamen (Palette). */
async function einsatzMitPumpe(page: Page): Promise<number> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Ortssuche ${Date.now()}`,
  });
  const id = await post(page, `/api/einsaetze/${einsatzId}/einheiten`, { name: 'Pumpe Ost' });
  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/einheiten/${id}/position`, {
    data: { lat: PUMPE[1], lon: PUMPE[0] },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  return einsatzId;
}

async function ruhe(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          return Boolean(k && k.loaded() && !k.isMoving());
        }),
      { timeout: 15_000, message: 'Karte kommt nicht zur Ruhe' },
    )
    .toBe(true);
}

/** Kartenmitte nach dem Anflug, auf fünf Stellen. */
async function mitte(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const c = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getCenter();
    return [Number(c.lng.toFixed(5)), Number(c.lat.toFixed(5))] as [number, number];
  });
}

/** Punkte der Suchnadel-Quelle (`suchnadelLayer.ts`). */
async function nadelPunkte(page: Page): Promise<unknown[]> {
  return page.evaluate(() =>
    (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte
      .querySourceFeatures('suchnadel')
      .map((f) => f.geometry.coordinates),
  );
}

async function aufSchirm(page: Page, ll: [number, number]) {
  return page.evaluate((c) => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const px = k.project(c);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: r.left + px.x, y: r.top + px.y };
  }, ll);
}

/** Fängt die Adresssuche ab; zählt die Suchtexte mit. */
async function geocoder(page: Page, treffer: { lat: number; lon: number; name: string }[]) {
  const anfragen: string[] = [];
  await page.route('**/karte/ort-suche?*', async (route) => {
    anfragen.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await route.fulfill({ json: { zustand: 'ok', treffer } });
  });
  return anfragen;
}

const ausgewaehlt = (page: Page) => page.locator('[data-paneel="ausgewaehlt"]');

test('Koordinate tippen → Anflug und Suchnadel; Tipp auf den Marker darunter wählt ihn', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const anfragen = await geocoder(page, []);
  await anmelden(page);
  const einsatzId = await einsatzMitPumpe(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await ruhe(page);

  const feld = page.getByLabel('Kartenobjekte suchen');
  await feld.fill('53.07750, 8.81000');
  await expect(page.getByRole('heading', { name: 'Koordinate' })).toBeVisible();
  await page.getByRole('button', { name: /^53\.0775\d*, 8\.81/ }).click();

  await expect(page.getByRole('region', { name: 'Suchnadel' })).toContainText('53.0775');
  await expect.poll(() => mitte(page), { timeout: 10_000 }).toEqual(PUMPE);
  await ruhe(page);
  await expect.poll(() => nadelPunkte(page)).toEqual([PUMPE]);

  // Die Nadel liegt genau auf der Pumpe — ein Tipp dort gehört der Pumpe.
  const punkt = await aufSchirm(page, PUMPE);
  await page.mouse.click(punkt.x, punkt.y);
  await expect(ausgewaehlt(page).getByText('Pumpe Ost')).toBeVisible();

  // Entfernen ist ein echter Klick im Fuß-Band (`toBeVisible` belegt keine Klickbarkeit).
  await page.getByRole('button', { name: 'Suchnadel entfernen' }).click();
  await expect(page.getByRole('region', { name: 'Suchnadel' })).toBeHidden();
  await expect.poll(() => nadelPunkte(page)).toEqual([]);

  // Eine Koordinate verlässt den Browser nicht.
  expect(anfragen).toEqual([]);
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test('Adresse auf Enter: genau ein Treffer fliegt ohne Klick hin', async ({ page }) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const ZIEL: [number, number] = [8.79, 53.08];
  const anfragen = await geocoder(page, [
    { lat: ZIEL[1], lon: ZIEL[0], name: 'Rathausplatz 1, Musterstadt' },
  ]);
  await anmelden(page);
  const einsatzId = await einsatzMitPumpe(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await ruhe(page);

  const feld = page.getByLabel('Kartenobjekte suchen');
  await feld.fill('Rathausplatz 1');
  // Tippen fragt nicht.
  expect(anfragen).toEqual([]);
  await feld.press('Enter');

  await expect(page.getByRole('region', { name: 'Suchnadel' })).toContainText(
    'Rathausplatz 1, Musterstadt',
  );
  await expect.poll(() => mitte(page), { timeout: 10_000 }).toEqual(ZIEL);
  expect(anfragen).toEqual(['Rathausplatz 1']);
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test('?ort= bei 390 px: Leiste offen, Treffer wählbar, Nadel-Band bedienbar', async ({ page }) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await page.setViewportSize({ width: 390, height: 844 });
  const anfragen = await geocoder(page, [
    { lat: 53.08, lon: 8.79, name: 'Hauptstraße 12, Musterstadt' },
    { lat: 52.5, lon: 13.4, name: 'Hauptstraße 12, Anderswo' },
  ]);
  await anmelden(page);
  const einsatzId = await einsatzMitPumpe(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte?ort=Hauptstra%C3%9Fe%2012`);

  await expect(page.getByRole('heading', { name: 'Adresse' })).toBeVisible();
  await expect(page.getByLabel('Kartenobjekte suchen')).toHaveValue('Hauptstraße 12');
  await expect(page).not.toHaveURL(/ort=/);
  expect(anfragen).toEqual(['Hauptstraße 12']);

  await page.getByRole('button', { name: 'Hauptstraße 12, Musterstadt' }).click();
  await expect(page.getByRole('region', { name: 'Suchnadel' })).toContainText(
    'Hauptstraße 12, Musterstadt',
  );
  await page.getByRole('button', { name: 'Suchnadel entfernen' }).click();
  await expect(page.getByRole('region', { name: 'Suchnadel' })).toBeHidden();
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
