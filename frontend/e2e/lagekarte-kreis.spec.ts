import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { waehleWerkzeug } from './leisten-kern';

/**
 * Kreis um einen Punkt am Fükw (LLH-1043, Spec `lagekarte-zeichnen`): Start im Werkzeugmenü
 * an der Karte, Mitte per Klick, Radius als Zahl, „Übernehmen“ legt an; der Inspector ändert den
 * Radius; der Link mit `:kreis&radius&mitte` belegt vor und räumt. Vitest belegt Band, Reducer und
 * Rechnung; hier: die echte Karte (Vorschau-Ebenen `td-zone-kreis-*`) und der echte Server
 * (Polygon, Kreisangaben, ETB).
 *
 * LLH-1345: der Radius-Griff wird gezogen (Maus am Fükw, Finger am Führungs-Tablet), und das Band
 * zeigt den Abstand zur Stelle unter dem Zeiger; die Messform „Radius“ zeigt ihren Kreis auf
 * eigenen Ebenen (`td-mess-kreis-*`) und baut ihn mit „Beenden“ ab. Gewartet wird nur auf
 * Zustände (stehende Karte, stehender Griff, Wert im Band), nie auf eine feste Zeit.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.use({ viewport: { width: 1440, height: 900 } });

interface MapHaken {
  isMoving(): boolean;
  jumpTo(o: { center: readonly [number, number]; zoom: number }): void;
  queryRenderedFeatures(o: { layers: string[] }): unknown[];
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

test('Kreis: Werkzeugmenü, Mitte per Klick, 300 m, Übernehmen; Inspector ändert den Radius', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { eid, canvas } = await lagekarteOeffnen(page);

  // Der Kreis ist eine Form im Werkzeugmenü an der Karte (LLH-1038).
  await waehleWerkzeug(page, 'Absperrbereich als Kreis');
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

// ── Radius-Griff ziehen (LLH-1345) ─────────────────────────────────────────────────────────────

/** Mitte aus dem Link: so steht sie fest, ohne dass ein Klick sie erst treffen muss. */
const MITTE = { lat: 54.12, lng: 9.5 };
/**
 * Der Zug nach innen und oben: zwischen Mitte und Griff liegt immer freie Karte, auch am Tablet,
 * wo rechts neben dem Griff schon die Kartenknöpfe stehen.
 */
const ZUG = { dx: -40, dy: -40 };

interface Punkt {
  x: number;
  y: number;
}

/** Großkreisabstand in Metern (wie `geo.ts`, genau genug für eine Toleranz von 2 %). */
function abstandM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const r = (g: number) => (g * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

/** Geokoordinate eines Bildschirmpunkts. */
async function geoAm(page: Page, p: Punkt): Promise<{ lng: number; lat: number }> {
  return page.evaluate(({ x, y }) => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const r = k.getCanvas().getBoundingClientRect();
    const g = k.unproject([x - r.left, y - r.top]);
    return { lng: g.lng, lat: g.lat };
  }, p);
}

/** Was unter einem Punkt obenauf liegt: der Griff, die Karte oder etwas anderes (Band, Knopf). */
async function obenauf(page: Page, p: Punkt): Promise<string> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (el?.closest('[data-lfh="kreisgriff"]')) return 'griff';
    if (el?.classList.contains('maplibregl-canvas')) return 'karte';
    return el?.outerHTML.slice(0, 160) ?? 'nichts';
  }, p);
}

/** Die Mitte bei Zoom 15 rund 120 px über die Kartenmitte holen: darunter liegt das Band. */
async function mitteInsBild(page: Page) {
  await kartenRuhe(page);
  await page.evaluate(
    ({ mitte }) => {
      const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
      k.jumpTo({ center: [mitte.lng, mitte.lat], zoom: 15 });
      const r = k.getContainer().getBoundingClientRect();
      const unten = k.unproject([r.width / 2, r.height / 2 + 120]);
      k.jumpTo({ center: [unten.lng, unten.lat], zoom: 15 });
    },
    { mitte: MITTE },
  );
  await kartenRuhe(page);
}

/** Wartet, bis der Griff an derselben Stelle zweimal gemeldet wird, und gibt seine Mitte. */
async function griffSteht(griff: Locator): Promise<Punkt> {
  let vorher = '';
  let jetzt: Punkt = { x: NaN, y: NaN };
  await expect
    .poll(
      async () => {
        const box = await griff.boundingBox();
        if (!box) return false;
        jetzt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const neu = JSON.stringify(jetzt);
        const ruhig = neu === vorher;
        vorher = neu;
        return ruhig;
      },
      { intervals: [100], message: 'Griff kommt nicht zur Ruhe' },
    )
    .toBe(true);
  return jetzt;
}

/** Ein Finger zieht über CDP von `von` nach `nach`; maplibres Marker nimmt jedes `touchmove`. */
async function fingerZug(cdp: CDPSession, von: Punkt, nach: Punkt, schritte = 12) {
  const finger = (p: Punkt) => [{ x: p.x, y: p.y, id: 0, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(von) });
  for (let i = 1; i <= schritte; i++) {
    const t = i / schritte;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: finger({ x: von.x + (nach.x - von.x) * t, y: von.y + (nach.y - von.y) * t }),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/**
 * Kreis per Link mit 300 m um `MITTE`, Griff ziehen (`ziehe`), Radius im Band prüfen, übernehmen.
 * Die Erwartung kommt nicht aus dem Code: Abstand der Mitte zur Stelle unter dem Zeiger am Ende.
 */
async function ziehePruefeUebernimm(
  page: Page,
  ziehe: (von: Punkt, nach: Punkt) => Promise<void>,
  tippen: boolean,
) {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { eid } = await lagekarteOeffnen(
    page,
    `?zeichnen=absperrbereich:kreis&radius=300&mitte=${MITTE.lat},${MITTE.lng}`,
  );
  const band = page.locator('[data-lfh="kreis-steuerung"]');
  await expect(band).toBeVisible();
  const feld = band.getByRole('spinbutton', { name: 'Radius in Metern' });
  await expect(feld).toHaveValue('300');
  await expect.poll(() => vorschauDa(page)).toBe(true);
  await mitteInsBild(page);

  const griff = page.locator('[data-lfh="kreisgriff"]');
  await expect(griff).toHaveCount(1);
  const von = await griffSteht(griff);
  const nach = { x: von.x + ZUG.dx, y: von.y + ZUG.dy };
  // Trefferwache: der Zug beginnt auf dem Griff und endet auf freier Karte, nie auf dem Band.
  expect(await obenauf(page, von), 'Griff liegt frei').toBe('griff');
  expect(await obenauf(page, nach), 'Ziel liegt auf der Karte').toBe('karte');
  const mitteVorher = await page.evaluate(() =>
    (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getCenter(),
  );

  await ziehe(von, nach);

  const erwartet = abstandM(MITTE, await geoAm(page, nach));
  // Der Zug macht den Kreis deutlich kleiner, aber nicht zum Punkt.
  expect(erwartet).toBeGreaterThan(100);
  expect(erwartet).toBeLessThan(270);
  await expect
    .poll(async () => Math.abs(Number(await feld.inputValue()) - erwartet) / erwartet, {
      message: `Radius im Band ≈ ${Math.round(erwartet)} m`,
    })
    .toBeLessThan(0.02);
  const radius = Number(await feld.inputValue());
  // Die Schnellwahl gibt den gezogenen Wert nicht als „300 m“ aus.
  await expect(band.getByRole('button', { name: '300 m' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Gezogen wurde der Griff, nicht die Karte.
  const mitteNachher = await page.evaluate(() =>
    (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getCenter(),
  );
  expect(mitteNachher.lng).toBeCloseTo(mitteVorher.lng, 9);
  expect(mitteNachher.lat).toBeCloseTo(mitteVorher.lat, 9);
  // Der Griff steht danach auf dem neuen Rand, unter dem Zeiger.
  const danach = await griffSteht(griff);
  expect(Math.hypot(danach.x - nach.x, danach.y - nach.y)).toBeLessThan(3);

  const uebernehmen = band.getByRole('button', { name: 'Übernehmen' });
  await (tippen ? uebernehmen.tap() : uebernehmen.click());
  await expect
    .poll(async () => (await zonen(page, eid)).map((z) => [z.typ, z.kreis_radius_m]))
    .toEqual([['absperrbereich', radius]]);
  expect(seitenFehler).toEqual([]);
}

test('Radius-Griff mit der Maus ziehen: das Band zeigt den neuen Radius, Übernehmen speichert ihn', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ziehePruefeUebernimm(
    page,
    async (von, nach) => {
      await page.mouse.move(von.x, von.y);
      await page.mouse.down();
      await page.mouse.move(nach.x, nach.y, { steps: 12 });
      await page.mouse.up();
    },
    false,
  );
});

test('Messen „Radius“: der Kreis steht auf eigenen Ebenen und geht mit „Beenden“', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { canvas } = await lagekarteOeffnen(page);
  await mitteInsBild(page);
  await page.getByRole('button', { name: 'Messen' }).click();
  await page.getByRole('radio', { name: 'Radius' }).click();
  const wert = page.locator('[data-lfh="messwert"]');
  await expect(wert).toHaveText('—');

  const box = (await canvas.boundingBox())!;
  const mitte = { x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 - 120 };
  const rand = { x: mitte.x + 100, y: mitte.y };
  expect(await obenauf(page, mitte), 'Mitte auf freier Karte').toBe('karte');
  expect(await obenauf(page, rand), 'Rand auf freier Karte').toBe('karte');
  await page.mouse.move(mitte.x, mitte.y);
  await page.mouse.click(mitte.x, mitte.y);
  await page.mouse.move(rand.x, rand.y, { steps: 4 });
  await page.mouse.click(rand.x, rand.y);
  await expect(wert).toContainText('r = ');

  const gezeichnet = () =>
    page.evaluate(() => {
      const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
      const ids = k.getStyle()?.layers?.map((l) => l.id) ?? [];
      const kreis = ids.filter((id) => id.startsWith('td-mess-kreis'));
      return {
        kreis,
        // Unter Linie und Punkten der Messung, damit sie bedienbar sichtbar bleiben.
        darunter: ids.indexOf('td-mess-kreis-linie') < ids.indexOf('td-mess-linestring'),
        sichtbar:
          kreis.length > 0 &&
          k.queryRenderedFeatures({ layers: ['td-mess-kreis-linie'] }).length > 0,
      };
    });
  await expect.poll(gezeichnet, { message: 'Vorschaukreis der Messung' }).toEqual({
    kreis: ['td-mess-kreis-flaeche', 'td-mess-kreis-linie'],
    darunter: true,
    sichtbar: true,
  });
  // Der Kreis der Messung ist keine Zone und nicht deren Vorschau.
  expect(await vorschauDa(page)).toBe(false);

  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();
  await expect.poll(async () => (await gezeichnet()).sichtbar).toBe(true);

  await page.getByRole('button', { name: 'Beenden' }).click();
  await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);
  await expect.poll(async () => (await gezeichnet()).kreis).toEqual([]);
  expect(seitenFehler).toEqual([]);
});

test.describe('Radius-Griff am Führungs-Tablet (Touch)', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('Radius-Griff mit dem Finger ziehen: das Band zeigt den neuen Radius, Übernehmen speichert ihn', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const cdp = await page.context().newCDPSession(page);
    await ziehePruefeUebernimm(page, (von, nach) => fingerZug(cdp, von, nach), true);
  });
});
