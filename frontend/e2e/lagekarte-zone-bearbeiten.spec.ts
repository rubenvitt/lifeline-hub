import { expect, test, type Page } from '@playwright/test';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { anmeldenPerApi } from './anmelde-kern';

/**
 * Zone bearbeiten am Fükw (LLH-1344, Spec `lagekarte-zeichnen`): eine Kreiszone punktweise ändern
 * (Eckgriff ziehen, „Übernehmen“) und die Mitte eines Kreises verschieben. Vitest belegt Reducer,
 * Band und Rechnung; hier: die echte Karte (Griffe als Marker, Vorschau `td-zone-bearbeiten-*`)
 * und der echte Server (genau ein PATCH, Kreisangaben weg, Polygon neu, ETB).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.use({ viewport: { width: 1440, height: 900 } });

interface MapHaken {
  isMoving(): boolean;
  jumpTo(o: { center: readonly [number, number]; zoom: number }): void;
  getContainer(): HTMLElement;
  getCenter(): { lng: number; lat: number };
  getStyle(): { layers?: { id: string }[] } | undefined;
  once(typ: 'click', f: (e: { lngLat: { lng: number; lat: number } }) => void): void;
}

interface ZoneAntwort {
  id: number;
  geometrie: string;
  kreis_radius_m?: number;
  kreis_mitte_lat?: number;
  kreis_mitte_lon?: number;
}

const MITTE = { lat: 54.0, lon: 9.5 };

async function lagekarteMitKreis(page: Page) {
  await anmeldenPerApi(page, ADMIN, PW);
  await einsatzDialogOeffnen(page);
  await page.getByLabel('Bezeichnung').fill(`E2E Zone bearbeiten ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const eid = Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
  const r = await page.request.post(`/api/incidents/${eid}/zones`, {
    data: {
      typ: 'absperrbereich',
      label: 'Nord',
      kreis: { mitte_lat: MITTE.lat, mitte_lon: MITTE.lon, radius_m: 300 },
    },
  });
  expect(r.status()).toBe(201);
  const zone = (await r.json()) as ZoneAntwort;
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  return { eid, zone };
}

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

/** Den Kreis groß in die Mitte holen und hineintippen: der Inspector der Zone öffnet sich. */
async function waehleKreis(page: Page) {
  await page.evaluate(
    ([lon, lat]) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({
        center: [lon, lat],
        zoom: 15,
      }),
    [MITTE.lon, MITTE.lat] as const,
  );
  await kartenRuhe(page);
  const m = await kartenMitte(page);
  await page.mouse.click(m.x, m.y);
  const inspector = page.locator('[data-lfh="auswahl"]');
  await expect(inspector.getByText('300 m')).toBeVisible();
  return inspector;
}

async function kartenMitte(page: Page) {
  return page.evaluate(() => {
    const r = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte
      .getContainer()
      .getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

async function zonen(page: Page, eid: number): Promise<ZoneAntwort[]> {
  return (await (await page.request.get(`/api/incidents/${eid}/zones`)).json()) as ZoneAntwort[];
}

async function etb(page: Page, eid: number): Promise<string[]> {
  const r = await page.request.get(`/api/incidents/${eid}/etb`);
  return ((await r.json()) as { inhalt: string }[]).map((x) => x.inhalt);
}

const vorschauDa = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte
        ?.getStyle()
        ?.layers?.some((l) => l.id === 'td-zone-bearbeiten-linie') ?? false,
  );

test('Kreiszone punktweise: Eckgriff ziehen, genau ein PATCH, Kreisangaben weg, ETB „geändert“', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { eid, zone } = await lagekarteMitKreis(page);
  const patches: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().endsWith(`/zones/${zone.id}`))
      patches.push(req.postData() ?? '');
  });

  const inspector = await waehleKreis(page);
  await inspector.getByRole('button', { name: 'Punkte bearbeiten' }).click();
  const band = page.locator('[data-lfh="bearbeiten-steuerung"]');
  await expect(band).toBeVisible();
  await expect(band).toContainText('Absperrbereich «Nord» bearbeiten');
  await expect(band).toContainText('64 Punkte');
  // Die Folge steht vorher im Band.
  await expect(band.getByText('Danach kein Kreis mehr', { exact: false })).toBeVisible();
  await expect.poll(() => vorschauDa(page)).toBe(true);
  await expect(band.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();

  // Einen Eckgriff um 60 px nach außen ziehen.
  const griff = page.locator('[data-lfh="zonengriff"]').first();
  await expect(griff).toBeVisible();
  const box = (await griff.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const mitte = await kartenMitte(page);
  const weg = { x: start.x - mitte.x, y: start.y - mitte.y };
  const laenge = Math.hypot(weg.x, weg.y) || 1;
  const ziel = { x: start.x + (weg.x / laenge) * 60, y: start.y + (weg.y / laenge) * 60 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + ziel.x) / 2, (start.y + ziel.y) / 2, { steps: 5 });
  await page.mouse.move(ziel.x, ziel.y, { steps: 5 });
  await page.mouse.up();

  await expect(band.getByRole('button', { name: 'Übernehmen' })).toBeEnabled();
  await band.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(band).toHaveCount(0);
  await expect.poll(() => vorschauDa(page)).toBe(false);
  // Die Zone steht wieder in der Auswahl — ohne Radius.
  await expect(inspector.getByRole('button', { name: 'Punkte bearbeiten' })).toBeVisible();
  await expect(inspector.getByRole('spinbutton', { name: 'Radius in Metern' })).toHaveCount(0);

  expect(patches).toHaveLength(1);
  expect(Object.keys(JSON.parse(patches[0]))).toEqual(['geometrie']);
  const [neu] = await zonen(page, eid);
  expect(neu.kreis_radius_m).toBeUndefined();
  expect(neu.kreis_mitte_lat).toBeUndefined();
  expect(neu.geometrie).not.toBe(zone.geometrie);
  expect(JSON.parse(neu.geometrie).coordinates[0]).toHaveLength(65);
  expect(await etb(page, eid)).toContain('Absperrbereich «Nord» geändert');
  expect(seitenFehler).toEqual([]);
});

test('Mitte verschieben: Tipp setzt die neue Mitte, der Radius bleibt, ETB nennt den Versatz', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { eid, zone } = await lagekarteMitKreis(page);
  const inspector = await waehleKreis(page);
  await inspector.getByRole('button', { name: 'Mitte verschieben' }).click();
  const band = page.locator('[data-lfh="kreis-steuerung"]');
  await expect(band).toBeVisible();
  await expect(band.getByRole('spinbutton', { name: 'Radius in Metern' })).toHaveValue('300');
  // Art fest, keine Serie.
  await expect(band.getByRole('combobox', { name: 'Art' })).toHaveCount(0);
  await expect(band.getByRole('switch', { name: 'Weitere zeichnen' })).toHaveCount(0);
  await expect(band.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  // Der Mittengriff steht (Radius vorhanden).
  await expect(page.locator('[data-lfh="kreisgriff-mitte"]')).toHaveCount(1);

  const m = await kartenMitte(page);
  await page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    k.once('click', (e) => {
      (window as unknown as { __mitteKlick: unknown }).__mitteKlick = e.lngLat;
    });
  });
  await page.mouse.click(m.x, m.y - 150);
  const klick = await page.evaluate(
    () => (window as unknown as { __mitteKlick: { lng: number; lat: number } }).__mitteKlick,
  );
  await band.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(band).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Mitte verschieben' })).toBeVisible();

  await expect
    .poll(async () => (await zonen(page, eid))[0].kreis_mitte_lat)
    .toBeCloseTo(klick.lat, 6);
  const [neu] = await zonen(page, eid);
  expect(neu.kreis_radius_m).toBe(300);
  expect(neu.kreis_mitte_lon).toBeCloseTo(klick.lng, 6);
  expect(neu.geometrie).not.toBe(zone.geometrie);
  expect(
    (await etb(page, eid)).some((t) => /^Absperrbereich «Nord»: Mitte um .+ m versetzt$/.test(t)),
  ).toBe(true);
});

/** Mitte eines Griffs auf dem Bildschirm. */
async function griffMitte(page: Page, kennung: string) {
  const box = (await page.locator(`[data-lfh="${kennung}"]`).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Einen Griff greifen, ziehen, bei gedrückter Taste Esc, weiterziehen, loslassen (LLH-1891). Nach
 * Esc darf weder `drag` noch `dragend` den verworfenen Stand zurückbringen.
 */
async function ziehenMitEsc(page: Page, kennung: string, versatz: { x: number; y: number }) {
  const start = await griffMitte(page, kennung);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + versatz.x / 2, start.y + versatz.y / 2, { steps: 5 });
  await page.mouse.move(start.x + versatz.x, start.y + versatz.y, { steps: 5 });
  return {
    start,
    esc: () => page.keyboard.press('Escape'),
    weiterUndLoslassen: async () => {
      await page.mouse.move(start.x + versatz.x * 2, start.y + versatz.y * 2, { steps: 5 });
      await page.mouse.up();
    },
  };
}

test('Esc mitten im Zug am Kreis einer Zone stellt den gespeicherten Kreis her, der Zug ändert ihn nicht mehr (LLH-1891)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await lagekarteMitKreis(page);
  const inspector = await waehleKreis(page);
  await inspector.getByRole('button', { name: 'Mitte verschieben' }).click();
  const band = page.locator('[data-lfh="kreis-steuerung"]');
  const uebernehmen = band.getByRole('button', { name: 'Übernehmen' });
  const radius = band.getByRole('spinbutton', { name: 'Radius in Metern' });
  await expect(page.locator('[data-lfh="kreisgriff-mitte"]')).toHaveCount(1);
  const mitte = await kartenMitte(page);

  for (const [kennung, versatz] of [
    ['kreisgriff-mitte', { x: 0, y: -80 }],
    ['kreisgriff', { x: 80, y: 0 }],
  ] as const) {
    const vorher = await griffMitte(page, kennung);
    const zug = await ziehenMitEsc(page, kennung, versatz);
    await expect(uebernehmen).toBeEnabled();
    await zug.esc();
    await expect(page.getByText('Zeichnung verworfen').first()).toBeVisible();
    await expect(uebernehmen).toBeDisabled();
    await zug.weiterUndLoslassen();

    // Der Griff steht wieder am gespeicherten Kreis, nicht unter dem Zeiger.
    await expect
      .poll(async () => {
        const jetzt = await griffMitte(page, kennung);
        return Math.hypot(jetzt.x - vorher.x, jetzt.y - vorher.y);
      })
      .toBeLessThan(3);
    await expect(uebernehmen).toBeDisabled();
    await expect(radius).toHaveValue('300');
    await expect(band).toBeVisible();
  }
  // Der Mittengriff sitzt auf der Kreismitte in der Kartenmitte.
  const m = await griffMitte(page, 'kreisgriff-mitte');
  expect(Math.hypot(m.x - mitte.x, m.y - mitte.y)).toBeLessThan(3);

  // Danach lässt sich der Griff wieder greifen.
  await ziehenMitEsc(page, 'kreisgriff-mitte', { x: 0, y: -60 });
  await page.mouse.up();
  await expect(uebernehmen).toBeEnabled();
  expect(seitenFehler).toEqual([]);
});

test('Esc mitten im Punktzug stellt die gespeicherte Form her, Loslassen setzt keinen Punkt (LLH-1891)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  await lagekarteMitKreis(page);
  const inspector = await waehleKreis(page);
  await inspector.getByRole('button', { name: 'Punkte bearbeiten' }).click();
  const band = page.locator('[data-lfh="bearbeiten-steuerung"]');
  const uebernehmen = band.getByRole('button', { name: 'Übernehmen' });
  await expect.poll(() => vorschauDa(page)).toBe(true);
  await expect(uebernehmen).toBeDisabled();

  // Erst eine Änderung: ohne sie beendete Esc das Bearbeiten statt zu verwerfen.
  await ziehenMitEsc(page, 'zonengriff', { x: -40, y: 0 });
  await page.mouse.up();
  await expect(uebernehmen).toBeEnabled();

  const zug = await ziehenMitEsc(page, 'zonengriff', { x: 0, y: 50 });
  await zug.esc();
  await expect(page.getByText('Zeichnung verworfen').first()).toBeVisible();
  await expect(uebernehmen).toBeDisabled();
  await zug.weiterUndLoslassen();

  await expect(band).toBeVisible();
  await expect(band).toContainText('64 Punkte');
  // Kein Nachzügler aus dem Zug: nach zwei Bildern hat React ein `dragend` längst übernommen.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(uebernehmen).toBeDisabled();
  expect(seitenFehler).toEqual([]);
});
