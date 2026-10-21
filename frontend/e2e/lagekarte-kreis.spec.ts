import { expect, test, type Page } from '@playwright/test';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { zeigeLeistenAnsicht } from './leisten-kern';

/**
 * Kreis um einen Punkt am Fükw (LLH-1043, Spec `lagekarte-zeichnen`): Start im Paneel
 * „Zeichnen“, Mitte per Klick, Radius als Zahl, „Übernehmen“ legt an; der Inspector ändert den
 * Radius; der Link mit `:kreis&radius&mitte` belegt vor und räumt. Vitest belegt Band, Reducer und
 * Rechnung; hier: die echte Karte (Vorschau-Ebenen `td-zone-kreis-*`) und der echte Server
 * (Polygon, Kreisangaben, ETB).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.use({ viewport: { width: 1440, height: 900 } });

interface MapHaken {
  isMoving(): boolean;
  jumpTo(o: { center: readonly [number, number]; zoom: number }): void;
  getContainer(): HTMLElement;
  once(typ: 'click', f: (e: { lngLat: { lng: number; lat: number } }) => void): void;
  getCenter(): { lng: number; lat: number };
  getStyle(): { layers?: { id: string }[] } | undefined;
  unproject(p: [number, number]): { lng: number; lat: number };
  getCanvas(): HTMLCanvasElement;
}

interface ZoneAntwort {
  id: number;
  typ: string;
  geometrie: string;
  kreis_radius_m?: number;
  kreis_mitte_lat?: number;
  kreis_mitte_lon?: number;
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function lagekarteOeffnen(page: Page, suche = '') {
  await anmelden(page);
  await einsatzDialogOeffnen(page);
  await page.getByLabel('Bezeichnung').fill(`E2E Kreis ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const eid = Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
  await page.goto(`/einsaetze/${eid}/lagekarte${suche}`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  return { eid, canvas };
}

const vorschauDa = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte
        ?.getStyle()
        ?.layers?.some((l) => l.id === 'td-zone-kreis-flaeche') ?? false,
  );

/** Wartet, bis die Karte steht und ihre Mitte zweimal gleich gemeldet hat. */
async function kartenRuhe(page: Page) {
  let vorher = '';
  await expect
    .poll(
      async () => {
        const jetzt = await page.evaluate(() => {
          const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
          return k.isMoving() ? 'bewegt' : JSON.stringify(k.getCenter());
        });
        const ruhig = jetzt !== 'bewegt' && jetzt === vorher;
        vorher = jetzt;
        return ruhig;
      },
      { intervals: [250] },
    )
    .toBe(true);
}

async function zonen(page: Page, eid: number): Promise<ZoneAntwort[]> {
  return (await (await page.request.get(`/api/einsaetze/${eid}/zonen`)).json()) as ZoneAntwort[];
}

async function etb(page: Page, eid: number): Promise<string[]> {
  const r = await page.request.get(`/api/einsaetze/${eid}/etb`);
  return ((await r.json()) as { inhalt: string }[]).map((x) => x.inhalt);
}

test('Kreis: Paneel, Mitte per Klick, 300 m, Übernehmen; Inspector ändert den Radius', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { eid, canvas } = await lagekarteOeffnen(page);

  // Das Paneel „Zeichnen“ liegt in der Ansicht „Objekte“ der Leiste (LLH-1028).
  await zeigeLeistenAnsicht(page, 'Objekte');
  await page.getByRole('button', { name: 'Absperrbereich als Kreis' }).click();
  const band = page.locator('[data-lfh="kreis-steuerung"]');
  await expect(band).toBeVisible();
  // Kein terra-draw-Zeichnen im Kreis-Modus: die Zeichnen-Steuerung fehlt.
  await expect(page.getByRole('button', { name: 'Abschließen' })).toHaveCount(0);

  // Die Karte steht (Anflug auf den Start beendet): sonst trifft der Klick eine andere Stelle als
  // die vorher umgerechnete.
  await kartenRuhe(page);
  // Mitte über der Kartenmitte: darunter liegt das Band im Kartenfuß.
  const box = (await canvas.boundingBox())!;
  const klick = { x: box.x + box.width / 2, y: box.y + box.height / 2 - 120 };
  // Die Stelle, wie die Karte selbst den Klick meldet: daran muss die Mitte stehen.
  await page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    k.once('click', (e) => {
      (window as unknown as { __kreisKlick: unknown }).__kreisKlick = e.lngLat;
    });
  });
  await page.mouse.click(klick.x, klick.y);
  const klickLl = await page.evaluate(
    () => (window as unknown as { __kreisKlick: { lng: number; lat: number } }).__kreisKlick,
  );
  await expect(band.locator('[data-lfh="kreis-mitte"]')).not.toContainText('—');

  const feld = band.getByRole('spinbutton', { name: 'Radius in Metern' });
  await feld.fill('300');
  await expect.poll(() => vorschauDa(page)).toBe(true);
  // Der Griff am Rand steht an der Karte.
  await expect(page.locator('[data-lfh="kreisgriff"]')).toHaveCount(1);

  await band.getByRole('button', { name: 'Übernehmen' }).click();
  // Serie (Vorgabe an): der nächste Kreis beginnt ohne Mitte, der Radius bleibt stehen.
  await expect(band).toContainText('1 gespeichert');
  await expect(band.locator('[data-lfh="kreis-mitte"]')).toContainText('—');
  await expect(band.getByRole('spinbutton', { name: 'Radius in Metern' })).toHaveValue('300');
  await band.getByRole('button', { name: /Fertig/ }).click();
  await expect(band).toHaveCount(0);
  await expect.poll(() => vorschauDa(page)).toBe(false);
  await expect(page.locator('[data-lfh="kreisgriff"]')).toHaveCount(0);

  const [zone] = await zonen(page, eid);
  expect(zone).toMatchObject({ typ: 'absperrbereich', kreis_radius_m: 300 });
  expect(zone.kreis_mitte_lat).toBeCloseTo(klickLl.lat, 5);
  expect(zone.kreis_mitte_lon).toBeCloseTo(klickLl.lng, 5);
  expect(JSON.parse(zone.geometrie).coordinates[0]).toHaveLength(65);
  expect(await etb(page, eid)).toContain('Absperrbereich eingerichtet · Kreis r = 300 m');

  // Inspector: Zone wählen (Klick in den Kreis), Radius auf 500 m.
  // Den Kreis groß in die Mitte holen und hineintippen.
  await page.evaluate(
    ([lon, lat]) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({
        center: [lon, lat],
        zoom: 15,
      }),
    [zone.kreis_mitte_lon!, zone.kreis_mitte_lat!] as const,
  );
  await kartenRuhe(page);
  const mitte = await page.evaluate(() => {
    const r = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte
      .getContainer()
      .getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(mitte.x, mitte.y);
  const inspector = page.locator('[data-lfh="auswahl"]');
  await expect(inspector.getByText('300 m')).toBeVisible();
  const radius = inspector.getByRole('spinbutton', { name: 'Radius in Metern' });
  await radius.fill('500');
  await radius.press('Enter');
  await expect
    .poll(async () => (await zonen(page, eid))[0].kreis_radius_m, { message: 'Radius neu' })
    .toBe(500);
  expect(await etb(page, eid)).toContain('Absperrbereich: Radius 300 m → 500 m');
  expect(seitenFehler).toEqual([]);
});

test('Kreis per Link: Radius und Mitte vorbelegt, alle drei Parameter geräumt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { eid } = await lagekarteOeffnen(
    page,
    '?zeichnen=gefahrengebiet:kreis&radius=1000&mitte=54.12,9.5',
  );
  const band = page.locator('[data-lfh="kreis-steuerung"]');
  await expect(band).toBeVisible();
  await expect(band.getByRole('spinbutton', { name: 'Radius in Metern' })).toHaveValue('1000');
  await expect(band.getByRole('button', { name: '1000 m' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).not.toHaveURL(/zeichnen|radius|mitte/);
  await expect.poll(() => vorschauDa(page)).toBe(true);
  // Erst „Übernehmen“ legt an.
  expect(await zonen(page, eid)).toEqual([]);
  await band.getByRole('button', { name: 'Übernehmen' }).click();
  await expect
    .poll(async () => (await zonen(page, eid)).map((z) => [z.typ, z.kreis_radius_m]))
    .toEqual([['gefahrengebiet', 1000]]);
});
