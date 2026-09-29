import { expect, test, type CDPSession, type Page } from '@playwright/test';

// Die Lagekarte unter Touch, auf Handschirm (390 px) und Führungs-Tablet (1024 px).
//
// Jede Geste belegt ihre Wirkung am KARTENZUSTAND (`getZoom`/`getCenter`/`getBearing`/
// `getPitch`, Auswahl im Paneel, gespeicherte Zone), nie an einem Bildschirmfoto. Jede
// Kartengeste startet hinter einer Trefferwache (`aufKarte`): ein Finger auf einem Band oder
// Knopf bewegt die Karte nicht, „keine Wirkung" wäre dann wertlos.
//
// Mehrfinger-Gesten laufen über CDP `Input.dispatchTouchEvent` (Playwrights `touchscreen`
// kennt nur Tipps); die Punkte tragen eine stabile `id`, MapLibre ordnet die Finger über
// `identifier` zu.
//
// Zwei Festlegungen, die hier gemessen werden:
//  - Die Lagekarte bleibt Draufsicht (`touchPitch: false` + `maxPitch: 0`). MapLibre kippt nur,
//    wenn die Finger NEBENEINANDER liegen und sich gemeinsam nach OBEN bewegen; ein Zug nach
//    unten sähe auch ohne Abschaltung ungekippt aus — deshalb die Positivkontrolle.
//  - Unter `lg` schließt die Werkzeugwahl die Leiste, und der Fuß endet an der Karte — sonst
//    bliebe bei 390 px im Zeichenmodus keine Karte zum Tippen.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  isMoving(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number; bearing?: number; pitch?: number }): void;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  getBearing(): number;
  getPitch(): number;
  project(ll: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

interface Punkt {
  x: number;
  y: number;
}

/** Kartenzustand, wie ihn die Zusicherungen lesen. */
interface Stand {
  zoom: number;
  lng: number;
  lat: number;
  bearing: number;
  pitch: number;
}

// Drei Einheiten wenige Meter auseinander bilden bei Zoom 14 EINEN Kräfte-Cluster (DOM-Donut);
// die vierte steht rund 670 m östlich und bleibt ein Einzelzeichen (WebGL). Damit sind die drei
// Trefferwege abgedeckt: Einzelmarker, Donut, Spider-Leaf.
const MITTE: [number, number] = [8.8, 53.0775];
const EINZEL: [number, number] = [MITTE[0] + 0.01, MITTE[1]];
/** Blickpunkt für die Tipps: zwischen Traube und Einzelzeichen, beide je rund 58 px daneben —
 *  auch bei 390 px im Bild. */
const ZWISCHEN: [number, number] = [MITTE[0] + 0.005, MITTE[1]];
const TRAUBE = ['Wache Nord', 'Wache Mitte', 'Wache Süd'];
const ZOOM = 14;

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

async function einheitAn(page: Page, einsatzId: number, name: string, ll: [number, number]) {
  const id = await post(page, `/api/einsaetze/${einsatzId}/einheiten`, { name });
  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/einheiten/${id}/position`, {
    data: { lat: ll[1], lon: ll[0] },
  });
  expect(antwort.ok(), `Position ${name}: ${await antwort.text()}`).toBeTruthy();
}

/** Einsatz mit der Traube und dem Einzelzeichen. Kein Modulname im Einsatznamen (Palette). */
async function einsatzMitLage(page: Page): Promise<number> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Fingerlage ${Date.now()}`,
  });
  for (const [i, name] of TRAUBE.entries()) {
    await einheitAn(page, einsatzId, name, [MITTE[0] + i * 0.00005, MITTE[1] + i * 0.00003]);
  }
  await einheitAn(page, einsatzId, 'Pumpe Ost', EINZEL);
  return einsatzId;
}

async function stand(page: Page): Promise<Stand> {
  return page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const c = k.getCenter();
    return {
      zoom: k.getZoom(),
      lng: c.lng,
      lat: c.lat,
      bearing: k.getBearing(),
      pitch: k.getPitch(),
    };
  });
}

/** Wartet, bis die Karte steht — Gesten laufen mit Trägheit nach. */
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

async function springe(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ({ c, z }) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({
        center: c,
        zoom: z,
        bearing: 0,
        pitch: 0,
      }),
    { c: center, z: zoom },
  );
  await ruhe(page);
}

/** Bildschirmpunkt (Viewport) einer Geokoordinate. */
async function aufSchirm(page: Page, ll: [number, number]): Promise<Punkt> {
  return page.evaluate((c) => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const px = k.project(c);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: r.left + px.x, y: r.top + px.y };
  }, ll);
}

/**
 * Trefferwache: an jedem Punkt liegt der Karten-Canvas obenauf — kein Band, kein Knopf, kein
 * Donut. Sonst wäre „die Geste hat nicht gekippt" auch grün, wenn der Finger daneben lag.
 */
async function aufKarte(page: Page, punkte: Punkt[], wo: string) {
  const treffer = await page.evaluate(
    (ps) =>
      ps.map((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el?.classList.contains('maplibregl-canvas') ? 'canvas' : (el?.outerHTML ?? 'nichts');
      }),
    punkte,
  );
  treffer.forEach((t, i) =>
    expect(t.slice(0, 160), `${wo}: Finger ${i} bei ${JSON.stringify(punkte[i])}`).toBe('canvas'),
  );
}

/**
 * Mitte der FREIEN Kartenfläche: sichtbarer Teil des Canvas oberhalb des Kartenfußes. Unten
 * liegen Zeitachse und Zeichnen-Steuerung über der Karte; bei 390 px mit ausgeklappter Zeitachse
 * bleibt darüber nur ein Streifen. Die Trefferwache fängt, was trotzdem danebengeht.
 */
async function kartenMitte(page: Page): Promise<Punkt> {
  const box = await page
    .getByTestId('kartenflaeche')
    .locator('canvas.maplibregl-canvas')
    .boundingBox();
  expect(box, 'Canvas hat keine Box').not.toBeNull();
  // Der Fuß-Rahmen reicht bis zur Oberkante der Karte; frei ist nur, was über seinem obersten
  // BAND liegt.
  const oberstesBand = await page
    .locator('[data-lfh="karten-fuss"] > *')
    .first()
    .boundingBox()
    .catch(() => null);
  const oben = Math.max(box!.y, 0);
  const unten = Math.min(
    box!.y + box!.height,
    oberstesBand?.y ?? Infinity,
    page.viewportSize()!.height,
  );
  return { x: box!.x + box!.width / 2, y: (oben + unten) / 2 };
}

/**
 * Mehrfinger-Geste über CDP. Jeder Finger ist eine Bahn `t ∈ [0,1] → Punkt`; alle Finger
 * setzen gemeinsam auf, bewegen sich in `schritte` gemeinsamen `touchMove`s und heben ab.
 */
async function geste(
  page: Page,
  cdp: CDPSession,
  finger: ((t: number) => Punkt)[],
  wo: string,
  schritte = 12,
  /** false, wenn die Geste bewusst NICHT auf der Karte startet (Rollen im Fuß). */
  nurAufKarte = true,
) {
  if (nurAufKarte)
    await aufKarte(
      page,
      finger.map((f) => f(0)),
      wo,
    );
  const punkte = (t: number) =>
    finger.map((f, id) => {
      const p = f(t);
      return { x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 };
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punkte(0) });
  for (let i = 1; i <= schritte; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: punkte(i / schritte),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await ruhe(page);
}

const linie =
  (a: Punkt, b: Punkt) =>
  (t: number): Punkt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

const bogen =
  (m: Punkt, r: number, von: number, bis: number) =>
  (t: number): Punkt => {
    const w = ((von + (bis - von) * t) * Math.PI) / 180;
    return { x: m.x + r * Math.cos(w), y: m.y + r * Math.sin(w) };
  };

/** Ein Tipp (touchStart/touchEnd). Was dort liegt, prüft der Aufrufer vorher (`aufKarte`). */
async function tippe(page: Page, p: Punkt) {
  await page.touchscreen.tap(p.x, p.y);
}

const ausgewaehlt = (page: Page) => page.locator('[data-paneel="ausgewaehlt"]');

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
]) {
  test.describe(`Lagekarte unter Touch bei ${viewport.width} px`, () => {
    test.use({ hasTouch: true, viewport });

    test('Gesten wirken, Kippen nicht; Norden richtet aus', async ({ page }) => {
      test.setTimeout(120_000);
      const seitenFehler: Error[] = [];
      page.on('pageerror', (f) => seitenFehler.push(f));
      await anmelden(page);
      const einsatzId = await einsatzMitLage(page);
      await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
      await expect(
        page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas'),
      ).toHaveCount(1);
      await ruhe(page);
      const cdp = await page.context().newCDPSession(page);

      // ── Pan: ein Finger zieht die Karte ──────────────────────────────────────────────
      await springe(page, MITTE, ZOOM);
      let m = await kartenMitte(page);
      const vorPan = await stand(page);
      await geste(page, cdp, [linie(m, { x: m.x - 90, y: m.y - 60 })], 'Pan');
      const nachPan = await stand(page);
      // Finger nach links oben → Kartenmitte wandert nach Osten und Süden.
      expect(nachPan.lng, 'Pan verschiebt nach Osten').toBeGreaterThan(vorPan.lng);
      expect(nachPan.lat, 'Pan verschiebt nach Süden').toBeLessThan(vorPan.lat);
      expect(nachPan.zoom).toBeCloseTo(vorPan.zoom, 1);

      // ── Pinch-Zoom: zwei Finger spreizen ─────────────────────────────────────────────
      await springe(page, MITTE, ZOOM);
      m = await kartenMitte(page);
      await geste(
        page,
        cdp,
        [
          linie({ x: m.x - 30, y: m.y }, { x: m.x - 120, y: m.y }),
          linie({ x: m.x + 30, y: m.y }, { x: m.x + 120, y: m.y }),
        ],
        'Pinch',
      );
      const nachPinch = await stand(page);
      // Abstand ×4 → rund zwei Stufen; die Schwelle bleibt locker gegen Trägheit.
      expect(nachPinch.zoom, 'Spreizen zoomt hinein').toBeGreaterThan(ZOOM + 1);

      // ── Drehen: erlaubt, „Norden" holt die Ausrichtung zurück ─────────────────────────
      await springe(page, MITTE, ZOOM);
      m = await kartenMitte(page);
      await geste(page, cdp, [bogen(m, 80, 180, 240), bogen(m, 80, 0, 60)], 'Drehen');
      const nachDrehen = await stand(page);
      expect(Math.abs(nachDrehen.bearing), 'Zwei Finger drehen die Karte').toBeGreaterThan(20);
      await page.getByRole('button', { name: 'Nach Norden ausrichten' }).tap();
      await expect
        .poll(async () => Math.abs((await stand(page)).bearing), {
          message: '„Nach Norden ausrichten" setzt die Drehung zurück',
        })
        .toBeLessThan(0.01);

      // ── Kippen: zwei Finger nebeneinander ziehen senkrecht — die Karte bleibt Draufsicht ─
      await springe(page, MITTE, ZOOM);
      m = await kartenMitte(page);
      const vorKippen = await stand(page);
      await geste(
        page,
        cdp,
        [
          linie({ x: m.x - 50, y: m.y + 60 }, { x: m.x - 50, y: m.y - 60 }),
          linie({ x: m.x + 50, y: m.y + 60 }, { x: m.x + 50, y: m.y - 60 }),
        ],
        'Kippen',
      );
      const nachKippen = await stand(page);
      expect(nachKippen.pitch, 'Kipp-Geste kippt nicht').toBe(0);
      // Positivkontrolle: die Geste KAM an und hat die Karte verschoben.
      expect(
        Math.abs(nachKippen.lat - vorKippen.lat),
        'Zwei-Finger-Zug erreicht die Karte',
      ).toBeGreaterThan(0.0005);

      // `maxPitch: 0` schließt auch die Tastatur (Umschalt+↑ kippt sonst um 10°).
      // Positivkontrolle ist Umschalt+→, das dreht.
      await springe(page, MITTE, ZOOM);
      await page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas').focus();
      // Jede Taste für sich abwarten: eine schnell folgende überschriebe die laufende Animation.
      await page.keyboard.press('Shift+ArrowUp');
      await ruhe(page);
      expect((await stand(page)).pitch, 'Umschalt+↑ kippt nicht').toBe(0);
      await page.keyboard.press('Shift+ArrowRight');
      await ruhe(page);
      expect(
        Math.abs((await stand(page)).bearing),
        'Umschalt+→ erreicht die Karte',
      ).toBeGreaterThan(5);

      expect(seitenFehler.map((f) => f.message)).toEqual([]);
    });

    test('Tipps treffen Einzelzeichen, Cluster und aufgefächerte Zeichen', async ({ page }) => {
      test.setTimeout(120_000);
      const seitenFehler: Error[] = [];
      page.on('pageerror', (f) => seitenFehler.push(f));
      await anmelden(page);
      const einsatzId = await einsatzMitLage(page);
      await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
      await ruhe(page);
      await springe(page, ZWISCHEN, ZOOM);

      // Einzelzeichen (WebGL-Layer). Wiederholt, bis die Marker-Quelle steht; ein
      // Wiederholtipp wählt dasselbe Zeichen erneut.
      await expect(async () => {
        const p = await aufSchirm(page, EINZEL);
        await aufKarte(page, [p], 'Einzelzeichen');
        await tippe(page, p);
        await expect(ausgewaehlt(page).getByText('Pumpe Ost')).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      // Die Auswahl kann die Karte bewegen, und jede Bewegung klappte einen Spider zu. Also
      // zurück auf den Blickpunkt und erst tippen, wenn die Karte steht.
      await springe(page, ZWISCHEN, ZOOM);

      // Cluster: ein DOM-Donut. GENAU EINMAL tippen — ein zweiter Tipp klappt den Spider zu.
      const donut = page.locator('.maplibregl-marker').filter({ hasText: '3' });
      await expect(donut).toHaveCount(1);
      const box = (await donut.boundingBox())!;
      const mitte = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const oben = await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el?.closest('.maplibregl-marker')
          ? 'donut'
          : (el?.outerHTML.slice(0, 200) ?? 'nichts');
      }, mitte);
      expect(oben, `der Donut liegt bei ${JSON.stringify(mitte)} obenauf`).toBe('donut');
      await tippe(page, mitte);

      // Der Spider fächert die drei Zeichen auf …
      const leaves = () =>
        page.evaluate(() => {
          const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
          return k
            .querySourceFeatures('spider-leaves')
            .map((f) => f.properties ?? {})
            .filter((p) => typeof p.schluessel === 'string');
        });
      await expect
        .poll(async () => new Set((await leaves()).map((p) => p.schluessel)).size, {
          message: 'Tipp auf den Donut fächert den Cluster auf',
        })
        .toBe(3);
      // … und ein aufgefächertes Zeichen ist per Tipp anwählbar. Der Punkt kommt aus der
      // Spider-Quelle (Pixelversatz), die Geokoordinate der Einheit läge unter dem Donut.
      const ziel = await page.evaluate(() => {
        const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
        const f = k
          .querySourceFeatures('spider-leaves')
          .find((x) => typeof x.properties?.schluessel === 'string') as unknown as {
          geometry: { coordinates: [number, number] };
        };
        const px = k.project(f.geometry.coordinates);
        const r = k.getCanvas().getBoundingClientRect();
        return { x: r.left + px.x, y: r.top + px.y };
      });
      await aufKarte(page, [ziel], 'Spider-Leaf');
      // Abstand zum Donut-Tipp: zwei Tipps binnen 500 ms und 30 px wären ein Doppeltipp-Zoom.
      await page.waitForTimeout(600);
      await tippe(page, ziel);
      const gewaehlt = ausgewaehlt(page);
      await expect(gewaehlt.getByText(/Wache (Nord|Mitte|Süd)/)).toBeVisible();

      expect(seitenFehler.map((f) => f.message)).toEqual([]);
    });

    test('Gefahrengebiet per Tipp zeichnen; Fußbänder mit Zeitachse klickbar', async ({ page }) => {
      test.setTimeout(120_000);
      const seitenFehler: Error[] = [];
      page.on('pageerror', (f) => seitenFehler.push(f));
      await anmelden(page);
      const einsatzId = await einsatzMitLage(page);
      await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
      await ruhe(page);
      await springe(page, MITTE, ZOOM);

      // Vorbedingung: die Bänder stapeln nur mit AUSGEKLAPPTER Zeitachse gegeneinander. Unter
      // `xl` startet sie eingeklappt — also einblenden und den Zustand zusichern.
      await page.getByRole('button', { name: 'Zeitachse einblenden' }).tap();
      await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();

      // „Zeichenwerkzeuge" auf der Karte öffnet die Leiste mit dem Paneel „Zeichnen".
      const zeichnen = async () => {
        await page.getByRole('button', { name: 'Zeichenwerkzeuge' }).tap();
        await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).tap();
      };
      const abschliessen = page.getByRole('button', { name: 'Abschließen' });

      // ── Abbrechen wird GETIPPT, nicht nur gesehen ───────────────────────────────────────
      await zeichnen();
      await expect(abschliessen).toBeVisible();
      await page.getByRole('button', { name: 'Abbrechen' }).tap();
      await expect(abschliessen).toBeHidden();

      // ── Drei Tipps, Abschließen, Speichern ──────────────────────────────────────────────
      await zeichnen();
      await expect(abschliessen).toBeVisible();
      const schmal = viewport.width < 992; // unter `lg` liegt die Leiste unter der Karte
      const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
      if (schmal) {
        // Die Werkzeugwahl gibt die Karte frei: die Leiste schließt, die Karte hat volle Höhe.
        await expect(page.getByRole('button', { name: 'Leiste einblenden' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Gefahrengebiet zeichnen' })).toHaveCount(0);
      }
      // Die Box erst jetzt holen: die Werkzeugwahl ändert Kartenhöhe und Fuß.
      const m = await kartenMitte(page);
      const ecken = [
        { x: m.x - 50, y: m.y - 30 },
        { x: m.x + 50, y: m.y - 30 },
        { x: m.x, y: m.y + 25 },
      ];
      await aufKarte(page, ecken, 'Zeichnen');
      for (const p of ecken) {
        await tippe(page, p);
        // Abstand gegen den Doppeltipp von terra-draw/MapLibre.
        await page.waitForTimeout(600);
      }
      await abschliessen.tap();
      // „Speichern" statt der Warnung „Mindestens 3 …": die drei Tipps sind angenommen.
      const speichern = page.getByRole('button', { name: 'Speichern', exact: true });
      await expect(speichern).toBeVisible();
      await speichern.tap();
      await expect(speichern).toBeHidden();
      await expect
        .poll(
          async () => {
            const zonen = (await (
              await page.request.get(`/api/einsaetze/${einsatzId}/zonen`)
            ).json()) as { typ: string; geometrie_typ: string }[];
            return zonen.filter((z) => z.typ === 'gefahrengebiet' && z.geometrie_typ === 'Polygon')
              .length;
          },
          { message: 'Gefahrengebiet ist als Fläche gespeichert' },
        )
        .toBe(1);

      if (schmal) {
        // ── Der Fuß bleibt in der Karte, auch wenn er höher wird als sie ───────────────────
        // Mit zurückgeholter Leiste ist der Fuß höher als die Karte. Unten verankert ohne
        // Obergrenze ragte er in den Seitenkopf und deckte „Leiste ausblenden" — der Tipp auf
        // genau diesen Knopf ist der Beleg.
        await expect(abschliessen).toBeVisible();
        await page.getByRole('button', { name: 'Leiste einblenden' }).tap();
        await expect(page.getByRole('button', { name: 'Gefahrengebiet zeichnen' })).toBeVisible();
        const karte = (await canvas.boundingBox())!;
        const steuerung = (await page
          .locator('[data-lfh="karten-fuss"] > .ant-card')
          .boundingBox())!;
        expect(
          steuerung.y,
          'Zeichen-Steuerung beginnt nicht über der Karte',
        ).toBeGreaterThanOrEqual(karte.y);
        // Was nicht passt, gibt die Zeitachse ab und rollt in sich. Vorbedingung: sie ist
        // wirklich gestaucht.
        const zeitachseEl = page.locator('[data-lfh="zeitachse"]');
        const rollen = () =>
          zeitachseEl.evaluate((e) => ({
            oben: e.scrollTop,
            mehr: e.scrollHeight - e.clientHeight,
          }));
        expect((await rollen()).mehr, 'Zeitachse ist gestaucht').toBeGreaterThan(0);
        // Der Finger setzt im Polster des Bands auf — ein Tipp auf die Schiene schaltete in den
        // Historienmodus.
        const zeitachse = (await zeitachseEl.boundingBox())!;
        const start = { x: zeitachse.x + 5, y: zeitachse.y + zeitachse.height / 2 };
        const unterFinger = await page.evaluate(
          (p) =>
            (document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.dataset.lfh ?? 'anderes',
          start,
        );
        expect(unterFinger, 'Finger liegt im Polster der Zeitachse').toBe('zeitachse');
        const cdp = await page.context().newCDPSession(page);
        await geste(
          page,
          cdp,
          [linie(start, { x: start.x, y: start.y - 80 })],
          'Zeitachse rollen',
          10,
          false,
        );
        await expect
          .poll(async () => (await rollen()).oben, { message: 'Zeitachse rollt per Finger' })
          .toBeGreaterThan(0);
        // In genau diesem Zustand bleiben das oberste Band und der Seitenkopf bedienbar —
        // getippt: der Serien-Schalter, dann „Leiste ausblenden".
        const serie = page.getByRole('switch', { name: 'Weitere zeichnen' });
        await expect(serie).toBeChecked();
        await serie.tap();
        await expect(serie).not.toBeChecked();
        await page.getByRole('button', { name: 'Leiste ausblenden' }).tap();
        await expect(page.getByRole('button', { name: 'Leiste einblenden' })).toBeVisible();
        // Die Serie endet per Tipp auf „Fertig".
        await page.getByRole('button', { name: 'Fertig' }).tap();
        await expect(abschliessen).toBeHidden();
      }

      expect(seitenFehler.map((f) => f.message)).toEqual([]);
    });
  });
}

// ── LFH-764: Griffe ohne Überlappung, ein Tipp gehört genau einem Ziel ─────────────────────────
//
// Führungs-Tablet (1024 px): die Leiste steht neben der Karte, Bilder und Fachebenen sind
// erreichbar. Die Dichte kommt aus dem gespeicherten Wert, die Wache prüft, dass sie ankam.

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface KarteLfh764 {
  project(ll: [number, number]): { x: number; y: number };
  unproject(p: [number, number]): { lng: number; lat: number };
  queryRenderedFeatures(p: [number, number]): { layer: { id: string } }[];
}

/**
 * Ecken eines am Schirm quadratischen Bildes um `mitte` (halbe Seite `halb` in Grad Breite), um
 * `grad` gedreht; Reihenfolge wie `eckenAusBounds` (NW, NO, SO, SW). In Web-Mercator ist ein Grad
 * Länge am Schirm `cos(Breite)` Grad Breite lang.
 */
function quadratEcken(mitte: [number, number], halb: number, grad: number): [number, number][] {
  const k = Math.cos((mitte[1] * Math.PI) / 180);
  const r = (grad * Math.PI) / 180;
  return [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) => {
    const dx = (x * Math.cos(r) - y * Math.sin(r)) * halb;
    const dy = (x * Math.sin(r) + y * Math.cos(r)) * halb;
    return [mitte[0] + dx / k, mitte[1] + dy] as [number, number];
  });
}

async function paneelAuf(page: Page, kennung: string) {
  const kopf = page.locator(`section[data-paneel="${kennung}"] button[aria-expanded]`).first();
  if ((await kopf.getAttribute('aria-expanded')) === 'false') await kopf.click();
  await expect(kopf).toHaveAttribute('aria-expanded', 'true');
}

test.describe('Lagekarte am Führungs-Tablet (LFH-764)', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  for (const dichte of ['kompakt', 'handschuh'] as const) {
    test(`Bildgriffe überlappen sich nicht, Stufe ${dichte}`, async ({ page }) => {
      test.setTimeout(180_000);
      const seitenFehler: Error[] = [];
      page.on('pageerror', (f) => seitenFehler.push(f));
      await page.addInitScript(
        ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
        [DICHTE_SCHLUESSEL, dichte] as const,
      );
      await anmelden(page);
      const einsatzId = await post(page, '/api/einsaetze', {
        bezeichnung: `E2E Griffprobe ${Date.now()}`,
      });
      // Zwei Bilder gleicher Größe: achsenparallel und um 45° gedreht.
      const faelle = [0, 45].map((grad) => ({
        grad,
        name: `Plan ${grad} Grad`,
        ecken: quadratEcken(MITTE, 0.0005, grad),
      }));
      for (const f of faelle) {
        const antwort = await page.request.post(
          `/api/einsaetze/${einsatzId}/karte/hintergrundbilder`,
          {
            multipart: {
              datei: { name: 'plan.png', mimeType: 'image/png', buffer: PNG },
              ecken: JSON.stringify(f.ecken),
              name: f.name,
            },
          },
        );
        expect(antwort.ok(), `Bild ${f.name}: ${await antwort.text()}`).toBeTruthy();
      }

      await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
      await ruhe(page);
      // Auf rund 120 px Kantenlänge zoomen: aus der bei Zoom 16 gemessenen Breite.
      await springe(page, MITTE, 16);
      const breite16 = await page.evaluate(([a, b]) => {
        const k = (window as unknown as { __lfhKarte: KarteLfh764 }).__lfhKarte;
        return Math.hypot(k.project(b).x - k.project(a).x, k.project(b).y - k.project(a).y);
      }, faelle[0].ecken);
      await springe(page, MITTE, 16 + Math.log2(120 / breite16));
      await paneelAuf(page, 'bilder');

      for (const f of faelle) {
        await page.getByRole('button', { name: `Aktionen zu ${f.name}` }).click();
        // Das Menü des vorigen Bildes kann noch ausblenden: nur das offene Dropdown zählt.
        await page
          .locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')
          .getByRole('menuitem', { name: 'Auf der Karte platzieren' })
          .click();
        const griffe = page.locator('[data-lfh^="bildgriff-"]');
        await expect(page.locator('[data-lfh="bildgriff-eck"]')).toHaveCount(4);

        const kante = await page.evaluate(([a, b]) => {
          const k = (window as unknown as { __lfhKarte: KarteLfh764 }).__lfhKarte;
          return Math.hypot(k.project(b).x - k.project(a).x, k.project(b).y - k.project(a).y);
        }, f.ecken);
        expect(kante, `${f.name}: Bildkante am Schirm`).toBeGreaterThan(100);
        expect(kante, `${f.name}: Bildkante am Schirm`).toBeLessThan(150);

        const boxen = await griffe.evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return {
              art: (el as HTMLElement).dataset.lfh!,
              x: r.x,
              y: r.y,
              b: r.width,
              h: r.height,
            };
          }),
        );
        const ueberlappend: string[] = [];
        for (let i = 0; i < boxen.length; i++)
          for (let j = i + 1; j < boxen.length; j++) {
            const [p, q] = [boxen[i], boxen[j]];
            const dx = Math.min(p.x + p.b, q.x + q.b) - Math.max(p.x, q.x);
            const dy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
            if (dx > 0.5 && dy > 0.5) ueberlappend.push(`${p.art}/${q.art}`);
          }
        expect(ueberlappend, `${f.name}, ${dichte}: überlappende scharfe Griffe`).toEqual([]);

        // Kompakt (Kante 44) lässt achsenparallel alle Kanten zu; gedreht liegen Kantenmitte und
        // Ecke je 42 px auseinander, in Handschuh (72) ohnehin zu nah.
        const mitKanten = dichte === 'kompakt' && f.grad === 0;
        await expect(page.locator('[data-lfh="bildgriff-kante"]')).toHaveCount(mitKanten ? 4 : 0);
        await expect(page.locator('[data-lfh="bildgriff-hinweis"]')).toContainText(
          mitKanten ? 'Kanten = frei strecken' : 'heranzoomen',
        );

        await page.getByRole('button', { name: /^Fertig$/ }).click();
        await expect(griffe).toHaveCount(0);
      }
      expect(seitenFehler.map((f) => f.message)).toEqual([]);
    });
  }

  test('Tipp auf ein KRITIS-Bündel im Ring eines Markers zoomt hinein, ohne den Marker zu wählen', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const seitenFehler: Error[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f));
    // Handschuh: Trefferzone 72 px, Ring bis 36 px um den Markerpunkt.
    await page.addInitScript(
      ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
      [DICHTE_SCHLUESSEL, 'handschuh'] as const,
    );
    // Hermetisch: die KRITIS-Ebene liefert vier Objekte an EINER Stelle — ein Bündel.
    let buendelOrt: [number, number] | null = null;
    await page.route('**/api/karte/fachebenen/kritis**', (route) =>
      route.fulfill({
        json: {
          quelle: 'kritis',
          status: 'ok',
          attribution: '© OpenStreetMap-Mitwirkende',
          features: {
            type: 'FeatureCollection',
            features: buendelOrt
              ? [0, 1, 2, 3].map((i) => ({
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [buendelOrt![0] + i * 1e-7, buendelOrt![1]],
                  },
                  properties: { name: `Objekt ${i}`, kategorie: 'krankenhaus' },
                }))
              : [],
          },
        },
      }),
    );
    await anmelden(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Klickziel ${Date.now()}`,
    });
    await einheitAn(page, einsatzId, 'Pumpe Ost', EINZEL);
    // Eine Zone um das Zeichen: ein Tipp aufs Zeichen gehört dem Marker, nicht der Zone.
    const zone = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
      data: {
        typ: 'gefahrengebiet',
        geometrie_typ: 'Polygon',
        geometrie: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [EINZEL[0] - 0.01, EINZEL[1] - 0.005],
              [EINZEL[0] + 0.01, EINZEL[1] - 0.005],
              [EINZEL[0] + 0.01, EINZEL[1] + 0.005],
              [EINZEL[0] - 0.01, EINZEL[1] + 0.005],
              [EINZEL[0] - 0.01, EINZEL[1] - 0.005],
            ],
          ],
        }),
        label: 'Sperrzone Probe',
      },
    });
    expect(zone.ok(), await zone.text()).toBeTruthy();

    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    await ruhe(page);
    // Zoom 13: KRITIS bündelt bis `clusterMaxZoom` 14.
    await springe(page, EINZEL, 13);
    // 30 px westlich des Zeichens: im Ring (36 px), außerhalb des gezeichneten Zeichens; östlich
    // liegt die Namensplakette, und die ist ein gezeichnetes Klickziel des Markers.
    buendelOrt = await page.evaluate((ll) => {
      const k = (window as unknown as { __lfhKarte: KarteLfh764 }).__lfhKarte;
      const p = k.project(ll);
      const o = k.unproject([p.x - 30, p.y]);
      return [o.lng, o.lat] as [number, number];
    }, EINZEL);

    await paneelAuf(page, 'fachebenen');
    await page.getByRole('switch', { name: 'KRITIS / sensible Objekte' }).click();

    // Vorbedingung am Tipppunkt: Bündel UND Trefferzone des Markers, aber kein gezeichnetes
    // Markerzeichen — sonst prüfte der Test nicht den Ring.
    const layerAm = () =>
      page.evaluate((ll) => {
        const k = (window as unknown as { __lfhKarte: KarteLfh764 }).__lfhKarte;
        const p = k.project(ll);
        return k.queryRenderedFeatures([p.x, p.y]).map((f) => f.layer.id);
      }, buendelOrt!);
    await expect
      .poll(layerAm, { timeout: 20_000, message: 'KRITIS-Bündel erscheint im Ring des Markers' })
      .toEqual(expect.arrayContaining(['fachebene-kritis-buendel', 'marker-treffer']));
    const amPunkt = await layerAm();
    expect(
      amPunkt.filter((id) => /^(marker|spider|personen)-/.test(id) && !id.endsWith('-treffer')),
      `am Tipppunkt nur die Trefferzone des Markers: ${amPunkt.join(', ')}`,
    ).toEqual([]);

    const vorher = (await stand(page)).zoom;
    const tipp = await aufSchirm(page, buendelOrt!);
    await aufKarte(page, [tipp], 'KRITIS-Bündel im Ring');
    await tippe(page, tipp);
    await expect
      .poll(async () => (await stand(page)).zoom, { message: 'Tipp aufs Bündel zoomt hinein' })
      .toBeGreaterThan(vorher + 0.5);
    await ruhe(page);
    await expect(page.locator('[data-lfh="auswahl"]')).toHaveCount(0);

    // Gegenprobe: das Zeichen selbst ist anwählbar, und zwar nur der Marker, nicht die Zone
    // darunter.
    await springe(page, EINZEL, 13);
    const zeichen = await aufSchirm(page, EINZEL);
    await aufKarte(page, [zeichen], 'Markerzeichen in der Zone');
    await page.waitForTimeout(600); // kein Doppeltipp-Zoom mit dem Tipp davor
    await tippe(page, zeichen);
    const auswahl = page.locator('[data-lfh="auswahl"] h3');
    await expect(auswahl).toHaveText(['Pumpe Ost']);
    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  });
});
