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
//  - Unter `lg` schließt jeder laufende Kartenmodus die Leiste, und der Fuß endet an der Karte —
//    sonst bliebe bei 390 px im Zeichenmodus keine Karte zum Tippen. Nach dem Modus hat die Leiste
//    wieder ihren vorherigen Zustand (LFH-765, eigener Block unten bei 390 und 768 px).

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
  unproject(p: [number, number]): { lng: number; lat: number };
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
 * Erster Kandidat, an dem der Karten-Canvas obenauf liegt. Überlagerungen (Seitenkopf, linke
 * Kartenüberlagerung samt Messsteuerung) sind je nach Schrift und Umbruch verschieden hoch —
 * ein einzelner fester Versatz landet in der CI darauf. Sonst wie `aufKarte`; im Fehlertext
 * stehen die ersten sechs Treffer.
 */
async function freierPunkt(page: Page, kandidaten: Punkt[], wo: string): Promise<Punkt> {
  const treffer = await page.evaluate(
    (ps) =>
      ps.map((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el?.classList.contains('maplibregl-canvas') ? 'canvas' : (el?.outerHTML ?? 'nichts');
      }),
    kandidaten,
  );
  const i = treffer.indexOf('canvas');
  expect(
    i,
    `${wo}: kein Kandidat frei — ${treffer
      .slice(0, 6)
      .map((t, j) => `${JSON.stringify(kandidaten[j])} → ${t.slice(0, 120)}`)
      .join(' | ')}`,
  ).toBeGreaterThanOrEqual(0);
  return kandidaten[i];
}

/**
 * Nächster freier Punkt zu `p`: ein Raster über den sichtbaren Canvas, nach Abstand zu `p`
 * sortiert, dann wie `freierPunkt`. Feste Versätze reichen bei 1024 px in der Handschuh-Stufe
 * nicht — rund um die Stelle liegen Seitenkopf, Kartenknöpfe, die linke Überlagerung samt
 * Messsteuerung und das offene Menü selbst, je nach Schrift verschieden groß.
 * `ausserhalb` (`[west, süd, ost, nord]`) schließt einen Rahmen aus, `fern` hält
 * `mindestens` Pixel Abstand zu jedem der Punkte.
 */
async function freierPunktNahe(
  page: Page,
  p: Punkt,
  wo: string,
  {
    ausserhalb,
    fern,
    mindestens = 50,
  }: { ausserhalb?: [number, number, number, number]; fern?: Punkt[]; mindestens?: number } = {},
): Promise<Punkt> {
  const raster = await page.evaluate((rahmen) => {
    const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
    const r = k.getCanvas().getBoundingClientRect();
    const rand = 0.0005; // Abstand zum Zonenrand, damit kein Tipp auf der Kante landet
    const punkte: { x: number; y: number }[] = [];
    for (let y = Math.max(r.top, 0) + 20; y < Math.min(r.bottom, innerHeight) - 20; y += 30)
      for (let x = Math.max(r.left, 0) + 20; x < Math.min(r.right, innerWidth) - 20; x += 30) {
        if (rahmen) {
          const [west, sued, ost, nord] = rahmen;
          const g = k.unproject([x - r.left, y - r.top]);
          if (
            g.lng > west - rand &&
            g.lng < ost + rand &&
            g.lat > sued - rand &&
            g.lat < nord + rand
          )
            continue;
        }
        punkte.push({ x, y });
      }
    return punkte;
  }, ausserhalb ?? null);
  const kandidaten = raster
    .filter((q) => (fern ?? []).every((f) => Math.hypot(q.x - f.x, q.y - f.y) >= mindestens))
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  return freierPunkt(page, kandidaten, wo);
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
      // Oben links liegen Kartengrundlage und Zeigerkoordinate über der Karte. Bei 1024 px endete
      // das Band 1 px rechts der linken oberen Ecke und 6 px über ihr, ein paar Pixel mehr Höhe
      // legten es auf den Zeichenpunkt (LFH-823). Die oberen Ecken bleiben deshalb mindestens
      // 8 px darunter; `kartenMitte` selbst bleibt, die Gesten hängen an ihrer Lage.
      const links = await page.locator('[data-lfh="karten-ueberlagerung-links"]').boundingBox();
      expect(links, 'Überlagerung oben links hat keine Box').not.toBeNull();
      const tiefer = Math.max(0, links!.y + links!.height + 8 - (m.y - 30));
      const ecken = [
        { x: m.x - 50, y: m.y - 30 + tiefer },
        { x: m.x + 50, y: m.y - 30 + tiefer },
        { x: m.x, y: m.y + 25 + tiefer },
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
        // Der Wisch rollt nach. Ein Tipp in den Nachlauf hält in Chromium nur das Rollen an:
        // `touchend` kommt am Schalter an, `click` nicht; in allen roten Läufen kam `scrollend`
        // erst rund 30 ms nach dem Tipp (LFH-823). Getippt wird deshalb erst, wenn die Zeitachse
        // steht: bei `scrollend` oder nach 150 ms ohne `scroll`.
        await zeitachseEl.evaluate(
          (e) =>
            new Promise<void>((fertig) => {
              let uhr = setTimeout(fertig, 150);
              e.addEventListener('scroll', () => {
                clearTimeout(uhr);
                uhr = setTimeout(fertig, 150);
              });
              e.addEventListener('scrollend', () => fertig(), { once: true });
            }),
        );
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
// `PNG` (1 × 1) steht beim LFH-765-Block unten.

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
        // Das Menü des vorigen Bildes kann unter Last noch ausblenden (gemessen im Sammel-Gate):
        // jedes Dropdown hat einen eigenen Portal-Container, der zuletzt geöffnete liegt hinten.
        await page
          .locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')
          .last()
          .getByRole('menuitem', { name: 'Auf der Karte platzieren' })
          .click();
        // Nur die Griffe auf der Karte, nicht der Hinweis `bildgriff-hinweis` in der Leiste.
        const griffe = page.locator(
          ['eck', 'kante', 'dreh', 'mitte'].map((a) => `[data-lfh="bildgriff-${a}"]`).join(', '),
        );
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
              [EINZEL[0] - 0.03, EINZEL[1] - 0.015],
              [EINZEL[0] + 0.03, EINZEL[1] - 0.015],
              [EINZEL[0] + 0.03, EINZEL[1] + 0.015],
              [EINZEL[0] - 0.03, EINZEL[1] + 0.015],
              [EINZEL[0] - 0.03, EINZEL[1] - 0.015],
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

    // Und die Zone bleibt wählbar, wo kein Marker und keine Trefferzone liegt: 120 px westlich.
    await page.keyboard.press('Escape');
    await springe(page, EINZEL, 13);
    const inZone = await page.evaluate((ll) => {
      const k = (window as unknown as { __lfhKarte: KarteLfh764 }).__lfhKarte;
      const p = k.project(ll);
      const r = (k as unknown as MapHaken).getCanvas().getBoundingClientRect();
      return { x: r.left + p.x - 120, y: r.top + p.y };
    }, EINZEL);
    await aufKarte(page, [inZone], 'Zone ohne Marker');
    await page.waitForTimeout(600);
    await tippe(page, inZone);
    await expect(auswahl).toHaveText(['Sperrzone Probe']);
    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  });
});

// ── LFH-765: Jeder Kartenmodus gibt unter `lg` die Karte frei ────────────────────────────────────
//
// Eigener Block bei 390 und 768 px, damit die Gesten oben nicht ein drittes Mal laufen. Bei 768 px
// ist die Leiste per Vorgabe offen, dort belegt der Block die Wiederherstellung nach dem Modus. Jede
// Bedienung wird GETIPPT, jede Wirkung am Serverstand oder am Messwert gelesen.

/** Unverortete Einheiten: sechs, damit „Nicht verortet" sein Suchfeld auch nach einem Treffer hält. */
const RESERVE = ['Reserve 1', 'Reserve 2', 'Reserve 3', 'Reserve 4', 'Reserve 5', 'Reserve 6'];
const BILDNAME = 'Lageplan Fingerprobe';
/** 1 × 1-PNG, wie in `lagekarte-leiste-dichte.spec.ts`. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
/** Bild um die MITTE: bei Zoom 14 rund 90 × 100 px, die Griffe liegen nicht übereinander. */
const BILD_ECKEN: [number, number][] = [
  [MITTE[0] - 0.004, MITTE[1] + 0.0025],
  [MITTE[0] + 0.004, MITTE[1] + 0.0025],
  [MITTE[0] + 0.004, MITTE[1] - 0.0025],
  [MITTE[0] - 0.004, MITTE[1] - 0.0025],
];

interface Modussaat {
  einsatzId: number;
  reserve: Record<string, number>;
  schadenId: number;
  bildId: number;
}

async function einsatzFuerModi(page: Page): Promise<Modussaat> {
  const einsatzId = await einsatzMitLage(page);
  const reserve: Record<string, number> = {};
  for (const name of RESERVE)
    reserve[name] = await post(page, `/api/einsaetze/${einsatzId}/einheiten`, { name });
  const schadenId = await post(page, `/api/einsaetze/${einsatzId}/schaeden`, {
    typ: 'sachschaden',
    ausmass: 'gering',
    ort: 'Fingerprobe Keller',
  });
  const bild = await page.request.post(`/api/einsaetze/${einsatzId}/karte/hintergrundbilder`, {
    multipart: {
      datei: { name: 'plan.png', mimeType: 'image/png', buffer: PNG },
      ecken: JSON.stringify(BILD_ECKEN),
      name: BILDNAME,
    },
  });
  expect(bild.ok(), `Seeding Bild: ${bild.status()} ${await bild.text()}`).toBeTruthy();
  const bildId = ((await bild.json()) as { id: number }).id;
  return { einsatzId, reserve, schadenId, bildId };
}

/** Die Leiste ist zu: aus dem Baum genommen (`hidden`), und der Kopf bietet das Einblenden an. */
async function leisteZu(page: Page) {
  await expect(page.locator('#lagekarte-leiste')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Leiste einblenden' })).toBeVisible();
}

async function leisteOffen(page: Page) {
  await expect(page.locator('#lagekarte-leiste')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leiste ausblenden' })).toBeVisible();
}

/** Zeitachse ausklappen — erst dann stapeln die Bänder gegeneinander. */
async function zeitachseAus(page: Page) {
  await page.getByRole('button', { name: 'Zeitachse einblenden' }).tap();
  await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();
}

/** Tipp in die Mitte der freien Karte, hinter der Trefferwache. */
async function tippeFrei(page: Page, wo: string): Promise<Punkt> {
  const m = await kartenMitte(page);
  await aufKarte(page, [m], wo);
  await tippe(page, m);
  return m;
}

const band = (page: Page) => page.locator('[data-lfh="platzier-steuerung"]');

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test.describe(`Kartenmodi geben bei ${viewport.width} px die Karte frei (LFH-765)`, () => {
    test.use({ hasTouch: true, viewport });
    /** Bei 768 px ist die Leiste per Vorgabe offen, bei 390 px zu. */
    const vorgabeOffen = viewport.width >= 768;

    let saat: Modussaat;
    const seitenFehler: Error[] = [];

    test.beforeEach(async ({ page }) => {
      test.setTimeout(150_000);
      seitenFehler.length = 0;
      page.on('pageerror', (f) => seitenFehler.push(f));
      await anmelden(page);
      saat = await einsatzFuerModi(page);
    });

    test.afterEach(() => {
      expect(seitenFehler.map((f) => f.message)).toEqual([]);
    });

    async function oeffneKarte(page: Page, query = '') {
      await page.goto(`/einsaetze/${saat.einsatzId}/lagekarte${query}`);
      await ruhe(page);
      await springe(page, MITTE, ZOOM);
      await zeitachseAus(page);
    }

    test('Platzieren aus „Nicht verortet": Tipp verortet, danach Leiste samt Suche zurück', async ({
      page,
    }) => {
      await oeffneKarte(page);
      if (!vorgabeOffen) await page.getByRole('button', { name: 'Leiste einblenden' }).tap();
      await leisteOffen(page);
      const suche = page.getByRole('textbox', { name: 'Nicht verortete Objekte durchsuchen' });
      await suche.fill('Reserve 3');
      await page
        .locator('[data-paneel="nichtVerortet"]')
        .getByRole('button', { name: 'Platzieren' })
        .tap();

      // Die Leiste weicht, die Bedienung steht über der Karte.
      await leisteZu(page);
      await expect(band(page)).toContainText('Platzieren · Einheit: Reserve 3');

      // Während des Modus lässt sich die Leiste zurückholen — ohne zweites „Abbrechen".
      await page.getByRole('button', { name: 'Leiste einblenden' }).tap();
      await leisteOffen(page);
      await expect(page.getByText('wird platziert')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Abbrechen' })).toHaveCount(1);
      await page.getByRole('button', { name: 'Leiste ausblenden' }).tap();
      await leisteZu(page);

      await tippeFrei(page, 'Platzieren');
      await expect
        .poll(
          async () => {
            const einheiten = (await (
              await page.request.get(`/api/einsaetze/${saat.einsatzId}/einheiten`)
            ).json()) as { id: number; lat: number | null }[];
            return einheiten.find((e) => e.id === saat.reserve['Reserve 3'])?.lat ?? null;
          },
          { message: 'Reserve 3 ist verortet' },
        )
        .not.toBeNull();

      // Modusende: vorheriger Zustand — offen, und der Suchbegriff steht noch.
      await expect(band(page)).toHaveCount(0);
      await leisteOffen(page);
      await expect(suche).toHaveValue('Reserve 3');
    });

    test('Verortungsauftrag per Adresse: Leiste zu, „Abbrechen" im Band beendet', async ({
      page,
    }) => {
      await oeffneKarte(page, `?platzieren=schaden:${saat.schadenId}`);
      await leisteZu(page);
      await expect(band(page)).toContainText('Platzieren · Schaden');
      await band(page).getByRole('button', { name: 'Abbrechen' }).tap();
      await expect(band(page)).toHaveCount(0);
      if (vorgabeOffen) await leisteOffen(page);
      else await leisteZu(page);
    });

    test('Taktisches Zeichen: Tipp setzt, „Fertig" im Band beendet', async ({ page }) => {
      await oeffneKarte(page);
      await page.getByRole('button', { name: 'Zeichenwerkzeuge' }).tap();
      const zeichnenPaneel = page.locator('[data-paneel="zeichnen"]');
      await zeichnenPaneel.getByRole('button', { name: 'Taktisches Zeichen platzieren' }).tap();
      // Im Paneel: „Nicht verortet" trägt eigene „Platzieren"-Knöpfe.
      await zeichnenPaneel.getByRole('button', { name: 'Platzieren', exact: true }).tap();

      await leisteZu(page);
      await expect(band(page)).toContainText('Taktisches Zeichen');
      await tippeFrei(page, 'Taktisches Zeichen');
      await expect
        .poll(
          async () =>
            (
              (await (
                await page.request.get(`/api/einsaetze/${saat.einsatzId}/freie-zeichen`)
              ).json()) as unknown[]
            ).length,
          { message: 'Freies Zeichen ist gespeichert' },
        )
        .toBe(1);
      // Serie ist Vorgabe: der Modus bleibt, bis „Fertig" getippt wird.
      await expect(band(page)).toContainText('1 platziert');
      await band(page).getByRole('button', { name: 'Fertig' }).tap();
      await expect(band(page)).toHaveCount(0);
      // „Zeichenwerkzeuge" hatte die Leiste geöffnet — das war der Zustand vor dem Modus.
      await leisteOffen(page);
    });

    test('Bild einpassen: Griff liegt frei, ein Zug verschiebt das Bild', async ({ page }) => {
      await page.evaluate(() =>
        localStorage.setItem('lfh:lagekarte:paneele', JSON.stringify({ bilder: true })),
      );
      await oeffneKarte(page);
      if (!vorgabeOffen) await page.getByRole('button', { name: 'Leiste einblenden' }).tap();
      await page.getByRole('button', { name: `Aktionen zu ${BILDNAME}` }).tap();
      await page.getByRole('menuitem', { name: 'Auf der Karte platzieren' }).tap();

      await leisteZu(page);
      await expect(band(page)).toContainText(`Bild einpassen · ${BILDNAME}`);
      await band(page).getByRole('radio', { name: 'Verschieben' }).tap();

      // Das Bild in die freie Kartenmitte rücken — über dem Fuß, nicht darunter.
      const frei = await kartenMitte(page);
      await page.evaluate(
        ({ p, ziel }) => {
          const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
          const r = k.getCanvas().getBoundingClientRect();
          const dort = k.unproject([p.x - r.left, p.y - r.top]);
          const c = k.getCenter();
          k.jumpTo({
            center: [c.lng + ziel[0] - dort.lng, c.lat + ziel[1] - dort.lat],
            zoom: k.getZoom(),
          });
        },
        { p: frei, ziel: MITTE },
      );
      await ruhe(page);

      const griff = page.locator('[data-lfh="bildgriff-mitte"]');
      await expect(griff).toHaveCount(1);
      const box = (await griff.boundingBox())!;
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const unterFinger = await page.evaluate(
        (p) =>
          (document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.closest<HTMLElement>(
            '[data-lfh^="bildgriff"]',
          )?.dataset.lfh ?? 'anderes',
        start,
      );
      expect(unterFinger, 'Griff „Mitte" liegt frei').toBe('bildgriff-mitte');

      const vorher = await bildEcken(page, saat);
      const cdp = await page.context().newCDPSession(page);
      await geste(
        page,
        cdp,
        [linie(start, { x: start.x + 40, y: start.y - 30 })],
        'Bild ziehen',
        12,
        false,
      );
      await expect
        .poll(async () => bildEcken(page, saat), { message: 'Bildlage ist gespeichert' })
        .not.toBe(vorher);

      await band(page).getByRole('button', { name: 'Fertig' }).tap();
      await expect(band(page)).toHaveCount(0);
      await leisteOffen(page);
    });

    test('Messen über den Kartenknopf: zwei Tipps messen, „Beenden" gibt die Leiste zurück', async ({
      page,
    }) => {
      await oeffneKarte(page);
      if (vorgabeOffen) await leisteOffen(page);
      else await leisteZu(page);
      await page.getByRole('button', { name: 'Messen' }).tap();
      await leisteZu(page);

      const m = await kartenMitte(page);
      const punkte = [
        { x: m.x - 40, y: m.y },
        { x: m.x + 40, y: m.y },
      ];
      await aufKarte(page, punkte, 'Messen');
      for (const p of punkte) {
        await tippe(page, p);
        await page.waitForTimeout(600);
      }
      await expect(page.locator('[data-lfh="messwert"]')).toContainText(/\d.*\s(m|km)\b/);

      await page.getByRole('button', { name: 'Beenden' }).tap();
      await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);
      if (vorgabeOffen) await leisteOffen(page);
      else await leisteZu(page);
    });
  });
}

async function bildEcken(page: Page, saat: Modussaat): Promise<string> {
  const bilder = (await (
    await page.request.get(`/api/einsaetze/${saat.einsatzId}/karte/hintergrundbilder`)
  ).json()) as { id: number; ecken_json: string }[];
  return bilder.find((b) => b.id === saat.bildId)?.ecken_json ?? '';
}

/** Achsenparalleles Rechteck als GeoJSON-Polygon (West, Süd, Ost, Nord). */
function rechteck(w: number, s: number, o: number, n: number) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [o, s],
        [o, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

// LFH-812: Liegen am Tipppunkt mehrere Flächen, wählt der Mensch im Auswahlmenü. Punktziele und
// Trefferzonen behalten die feste Rangfolge.
test.describe('Flächen-Auswahlmenü am Führungs-Tablet (LFH-812)', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('mehrere Flächen öffnen ein Menü, der Ring eines Markers nicht', async ({ page }) => {
    test.setTimeout(180_000);
    const seitenFehler: Error[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f));
    // Handschuh: Einträge müssen 72 px halten.
    await page.addInitScript(
      ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
      [DICHTE_SCHLUESSEL, 'handschuh'] as const,
    );
    // Hermetisch: eine DWD-Warnfläche über der Osthälfte der Zone.
    const [lng, lat] = EINZEL;
    await page.route('**/api/karte/fachebenen/dwd**', (route) =>
      route.fulfill({
        json: {
          quelle: 'dwd',
          status: 'ok',
          attribution: '© Deutscher Wetterdienst',
          features: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: rechteck(lng + 0.002, lat - 0.003, lng + 0.008, lat + 0.003),
                properties: { EVENT: 'STURMBÖEN', HEADLINE: 'Amtliche Warnung vor Sturmböen' },
              },
            ],
          },
        },
      }),
    );
    await anmelden(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E Flächenwahl ${Date.now()}`,
    });
    await einheitAn(page, einsatzId, 'Pumpe Ost', EINZEL);
    // Zone um das Zeichen, Abschnitt über ihrer Westhälfte samt Zeichen.
    const zone = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
      data: {
        typ: 'absperrbereich',
        geometrie_typ: 'Polygon',
        geometrie: JSON.stringify(rechteck(lng - 0.01, lat - 0.005, lng + 0.01, lat + 0.005)),
        label: 'Sperrzone Probe',
      },
    });
    expect(zone.ok(), await zone.text()).toBeTruthy();
    const abschnittId = await post(page, `/api/einsaetze/${einsatzId}/abschnitte`, {
      name: 'Deichwache Probe',
    });
    const flaeche = await page.request.patch(
      `/api/einsaetze/${einsatzId}/abschnitte/${abschnittId}/flaeche`,
      {
        data: {
          flaeche_geojson: JSON.stringify(
            rechteck(lng - 0.008, lat - 0.003, lng + 0.001, lat + 0.003),
          ),
        },
      },
    );
    expect(flaeche.ok(), await flaeche.text()).toBeTruthy();

    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    await ruhe(page);
    await springe(page, EINZEL, 15);

    const layerAm = (ll: [number, number]) =>
      page.evaluate((c) => {
        const k = (window as unknown as { __lfhKarte: KarteLfh764 }).__lfhKarte;
        const p = k.project(c);
        return k.queryRenderedFeatures([p.x, p.y]).map((f) => f.layer.id);
      }, ll);
    const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    const eintraege = menue.getByRole('menuitem');
    const auswahl = page.locator('[data-lfh="auswahl"] h3');
    // Die Leiste liegt links über der Karte: vor jedem Tipp den Punkt in die Mitte holen.
    const tippAuf = async (ll: [number, number], wo: string) => {
      await springe(page, ll, 15);
      const p = await aufSchirm(page, ll);
      await aufKarte(page, [p], wo);
      await page.waitForTimeout(600); // kein Doppeltipp-Zoom mit dem Tipp davor
      await tippe(page, p);
    };

    // 1. Zone und Abschnitt übereinander: Menü mit beiden. Abseits der Mitte des Abschnitts, dort
    // steht sein Befehlsstellen-Zeichen (ein Punktziel).
    const west: [number, number] = [lng - 0.007, lat + 0.002];
    await springe(page, west, 15);
    await expect
      .poll(() => layerAm(west), { message: 'Zone und Abschnitt liegen im Westen übereinander' })
      .toEqual(expect.arrayContaining(['zonen-fill', 'abschnitte-fill']));
    const amWest = await layerAm(west);
    expect(
      amWest.filter((id) => /^(marker|spider|personen)-/.test(id)),
      `im Westen kein Punktziel und keine Trefferzone: ${amWest.join(', ')}`,
    ).toEqual([]);
    await tippAuf(west, 'Überschneidung Zone/Abschnitt');
    await expect(menue).toBeVisible();
    await expect(menue).toHaveAttribute('aria-label', 'Fläche wählen');
    const texte = await eintraege.allTextContents();
    expect(texte).toHaveLength(2);
    expect(texte).toEqual(
      expect.arrayContaining(['Absperrbereich: Sperrzone Probe', 'Abschnitt: Deichwache Probe']),
    );
    await expect(auswahl).toHaveCount(0);
    // Die Einblendung skaliert von 0.8 hoch: gemessen wird der eingeschwungene Stand.
    await expect
      .poll(
        async () =>
          Math.min(
            ...(await Promise.all((await eintraege.all()).map((e) => e.boundingBox()))).map(
              (b) => b!.height,
            ),
          ),
        { message: 'Eintrag hält die Handschuh-Höhe' },
      )
      .toBeGreaterThanOrEqual(72);
    // Klicken, nicht nur sehen: der Eintrag nimmt den Tipp.
    await eintraege.filter({ hasText: 'Abschnitt: Deichwache Probe' }).tap();
    await expect(menue).toHaveCount(0);
    await expect(auswahl).toHaveText(['Deichwache Probe']);

    // 2. Tastatur: Esc schließt ohne Wahl, der Fokus geht an die Karte.
    await page
      .getByRole('button', { name: /schließen/i })
      .first()
      .click();
    await expect(auswahl).toHaveCount(0);
    await tippAuf(west, 'Überschneidung Zone/Abschnitt (Esc)');
    await expect(menue).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menue).toHaveCount(0);
    await expect(auswahl).toHaveCount(0);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeFocused();
    // Pfeil und Enter wählen den zweiten Eintrag.
    await tippAuf(west, 'Überschneidung Zone/Abschnitt (Pfeile)');
    await expect(menue).toBeVisible();
    const zweiter = (await eintraege.allTextContents())[1];
    // `autoFocus` legt den Fokus ins Menü, sobald es steht; erst dann gehören die Tasten ihm.
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="menu"]'))), {
        message: 'Fokus liegt im Menü',
      })
      .toBe(true);
    // Beim Öffnen steht der erste Eintrag schon aktiv; ein Pfeil führt zum zweiten.
    const aktiv = menue.locator('li.ant-dropdown-menu-item-active');
    await expect(aktiv).toHaveText([(await eintraege.allTextContents())[0]]);
    await page.keyboard.press('ArrowDown');
    await expect(aktiv).toHaveText([zweiter]);
    // Enter klickt das Element mit dem DOM-Fokus; rc-menu zieht ihn der Hervorhebung erst einen
    // Takt später nach (gemessen: sofortiges Enter traf in 2 von 6 Läufen den ersten Eintrag).
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ''), {
        message: 'Fokus folgt der Hervorhebung',
      })
      .toBe(zweiter);
    await page.keyboard.press('Enter');
    await expect(menue).toHaveCount(0);
    await expect(auswahl).toHaveText([zweiter.replace(/^[^:]+: /, '')]);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeFocused();
    await page
      .getByRole('button', { name: /schließen/i })
      .first()
      .click();

    // 3. Eine Kartenbewegung schließt das Menü, ohne dass antd davon weiß; der Fokus fällt
    // trotzdem nicht auf `body`.
    await tippAuf(west, 'Überschneidung Zone/Abschnitt (Bewegung)');
    await expect(menue).toBeVisible();
    await springe(page, EINZEL, 15.2);
    await expect(menue).toHaveCount(0);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeFocused();
    await springe(page, EINZEL, 15);

    // 3a. Im exklusiven Modus (Messen) gehört der Tipp dem Modus: kein Menü, Esc beendet ihn.
    await page.getByRole('button', { name: 'Messen' }).tap();
    await expect(page.getByRole('button', { name: 'Messen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Der Messwert steht im Fuß über der Kartenmitte: den Punkt in die freie Fläche darüber holen.
    await springe(page, west, 15);
    const frei = await kartenMitte(page);
    const jetzt = await aufSchirm(page, west);
    await page.evaluate(
      (d) =>
        (
          window as unknown as { __lfhKarte: { panBy(o: [number, number], a: object): void } }
        ).__lfhKarte.panBy([d.x, d.y], { duration: 0 }),
      { x: jetzt.x - frei.x, y: jetzt.y - frei.y },
    );
    await ruhe(page);
    expect(await layerAm(west)).toEqual(expect.arrayContaining(['zonen-fill', 'abschnitte-fill']));
    const messTipp = await aufSchirm(page, west);
    await aufKarte(page, [messTipp], 'Überschneidung Zone/Abschnitt (Messen)');
    await tippe(page, messTipp);
    await page.waitForTimeout(600);
    await expect(menue).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Messen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await springe(page, EINZEL, 15);

    // 4. Zone unter einer DWD-Warnfläche: eigene Fläche zuerst, dann die Warnung.
    await paneelAuf(page, 'fachebenen');
    await page.getByRole('switch', { name: 'Wetterwarnungen (DWD)' }).click();
    const ost: [number, number] = [lng + 0.005, lat];
    await expect
      .poll(() => layerAm(ost), { timeout: 20_000, message: 'DWD-Fläche liegt über der Zone' })
      .toEqual(expect.arrayContaining(['zonen-fill', 'fachebene-dwd-fill']));
    await tippAuf(ost, 'Zone unter DWD');
    await expect(menue).toBeVisible();
    await expect(eintraege).toHaveText([
      'Absperrbereich: Sperrzone Probe',
      'Wetterwarnungen (DWD): Sturmböen',
    ]);
    await eintraege.filter({ hasText: 'Sturmböen' }).tap();
    await expect(menue).toHaveCount(0);
    await expect(auswahl).toContainText(['Sturmböen']);
    await page
      .getByRole('button', { name: /schließen/i })
      .first()
      .click();

    // 5. Im Ring des Markers, über Zone UND Abschnitt: der Marker, kein Menü.
    await springe(page, EINZEL, 15);
    const ring = await page.evaluate((ll) => {
      const k = (window as unknown as { __lfhKarte: KarteLfh764 }).__lfhKarte;
      const p = k.project(ll);
      // Nördlich: östlich steht die eigene Namensplakette, westlich die des Abschnitts.
      const o = k.unproject([p.x, p.y - 30]);
      return [o.lng, o.lat] as [number, number];
    }, EINZEL);
    const amRing = await layerAm(ring);
    expect(amRing, `am Ring: ${amRing.join(', ')}`).toEqual(
      expect.arrayContaining(['marker-treffer', 'zonen-fill', 'abschnitte-fill']),
    );
    expect(
      amRing.filter((id) => /^(marker|spider|personen)-/.test(id) && !id.endsWith('-treffer')),
    ).toEqual([]);
    await tippAuf(ring, 'Ring des Markers');
    await expect(auswahl).toHaveText(['Pumpe Ost']);
    await expect(menue).toHaveCount(0);
    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  });
});

// LFH-776: Kontextmenü an der Kartenstelle. maplibre (ab 6.11) meldet einen langen Druck als
// `contextmenu`; gemessen wird, dass das Menü nach dem ABHEBEN noch offen ist (Nachklick-Riegel),
// die Karte dabei stillsteht und jeder Eintrag per Tipp wirkt — nicht bloß sichtbar ist.

/** Langer Druck mit einem Finger über CDP: aufsetzen, halten, abheben. */
async function langerDruck(page: Page, cdp: CDPSession, p: Punkt, ms = 700) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: p.x, y: p.y, id: 0, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Steuerhöhe je Dichtestufe (`frontend/AGENTS.md`, Dichte-Staffel). */
const STEUERHOEHE: Record<string, number> = { kompakt: 30, komfortabel: 48, handschuh: 72 };

const kontextMenue = (page: Page) =>
  page.locator(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label="Aktionen an dieser Stelle"]',
  );
const kontextKopf = (page: Page) => page.locator('[data-lfh="kontextmenue-anker-kopf"]');

interface KontextSaat {
  einsatzId: number;
  /** Freie Stelle: kein Marker, keine Zone. */
  frei: [number, number];
  /** In der Zone, abseits jedes Zeichens. */
  inZone: [number, number];
  /** Rahmen der Zone `[west, süd, ost, nord]` — „daneben“ heißt außerhalb davon. */
  zone: [number, number, number, number];
}

async function einsatzFuerKontext(page: Page): Promise<KontextSaat> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Kontextmenue ${Date.now()}`,
  });
  await einheitAn(page, einsatzId, 'Pumpe Ost', EINZEL);
  // Die Traube bildet einen Kräfte-Cluster: ein DOM-Donut ohne Klickebene (Review LFH-776).
  for (const [i, name] of TRAUBE.entries())
    await einheitAn(page, einsatzId, name, [MITTE[0] + i * 0.00005, MITTE[1] + i * 0.00003]);
  const [lng, lat] = EINZEL;
  const rahmen: [number, number, number, number] = [
    lng - 0.004,
    lat - 0.008,
    lng + 0.004,
    lat - 0.003,
  ];
  const zone = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
    data: {
      typ: 'absperrbereich',
      geometrie_typ: 'Polygon',
      geometrie: JSON.stringify(rechteck(...rahmen)),
      label: 'Sperrzone Kontext',
    },
  });
  expect(zone.ok(), await zone.text()).toBeTruthy();
  return {
    einsatzId,
    frei: [lng, lat + 0.004],
    inZone: [lng + 0.002, lat - 0.0055],
    zone: rahmen,
  };
}

/** Großkreisabstand in Metern (wie `geo.ts`, genau genug für eine Toleranz von 10 %). */
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

/** Holt `ll` in die freie Kartenmitte und gibt seinen Bildschirmpunkt — hinter der Trefferwache. */
async function stelleAufKarte(page: Page, ll: [number, number], wo: string): Promise<Punkt> {
  await springe(page, ll, 15);
  const m = await kartenMitte(page);
  const ziel = await page.evaluate(
    ({ x, y }) => {
      const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
      const r = k.getCanvas().getBoundingClientRect();
      const g = k.unproject([x - r.left, y - r.top]);
      return [g.lng, g.lat] as [number, number];
    },
    { x: m.x, y: m.y },
  );
  await springe(page, [ll[0] + (ll[0] - ziel[0]), ll[1] + (ll[1] - ziel[1])], 15);
  const p = await aufSchirm(page, ll);
  await aufKarte(page, [p], wo);
  await page.waitForTimeout(400); // kein Doppeltipp mit der Geste davor
  return p;
}

for (const { viewport, dichte } of [
  { viewport: { width: 1024, height: 768 }, dichte: 'handschuh' },
  { viewport: { width: 390, height: 844 }, dichte: null },
] as const) {
  test.describe(`Kontextmenü per langem Druck bei ${viewport.width} px (LFH-776)`, () => {
    test.use({ hasTouch: true, viewport });

    test('langer Druck öffnet das Menü an der Stelle; Messen ab hier misst ab dort', async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const seitenFehler: Error[] = [];
      page.on('pageerror', (f) => seitenFehler.push(f));
      if (dichte)
        await page.addInitScript(
          ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
          [DICHTE_SCHLUESSEL, dichte] as const,
        );
      await anmelden(page);
      const saat = await einsatzFuerKontext(page);
      await page.goto(`/einsaetze/${saat.einsatzId}/lagekarte`);
      if (dichte) await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
      await ruhe(page);
      const cdp = await page.context().newCDPSession(page);
      const menue = kontextMenue(page);
      const eintraege = menue.getByRole('menuitem');

      // ── Langer Druck auf freie Karte: Menü offen NACH dem Abheben, Karte steht ─────────
      const frei = await stelleAufKarte(page, saat.frei, 'freie Stelle');
      const vorher = await stand(page);
      const druckLl = await geoAm(page, frei);
      await langerDruck(page, cdp, frei);
      await expect(menue).toBeVisible();
      await page.waitForTimeout(500); // ein Nachklick käme jetzt — das Menü muss stehen bleiben
      await expect(menue).toBeVisible();
      const nachher = await stand(page);
      expect(nachher.zoom).toBeCloseTo(vorher.zoom, 6);
      expect(nachher.lng).toBeCloseTo(vorher.lng, 7);
      expect(nachher.lat).toBeCloseTo(vorher.lat, 7);
      expect(nachher.pitch).toBe(0);
      expect(nachher.bearing).toBe(0);
      await expect(kontextKopf(page)).toContainText(/\d{3}/);
      expect(await eintraege.allTextContents()).toEqual([
        'Koordinate kopieren',
        'Messen ab hier',
        'Hier Zeichen setzen',
      ]);
      // Anker an der Druckstelle (Pixel relativ zur Kartenhülle).
      const anker = await page.locator('[data-lfh="kontextmenue-anker"]').boundingBox();
      expect(Math.abs(anker!.x - frei.x)).toBeLessThan(2);
      expect(Math.abs(anker!.y - frei.y)).toBeLessThan(2);
      const stufe = (await page.locator('html').getAttribute('data-dichte')) ?? 'kompakt';
      await expect
        .poll(
          async () =>
            Math.min(
              ...(await Promise.all((await eintraege.all()).map((e) => e.boundingBox()))).map(
                (b) => b!.height,
              ),
            ),
          { message: `Einträge halten die Steuerhöhe der Stufe ${stufe}` },
        )
        .toBeGreaterThanOrEqual(STEUERHOEHE[stufe]);

      // ── „Messen ab hier“ per Tipp, dann ein zweiter Tipp: die Strecke steht ────────────
      await eintraege.filter({ hasText: 'Messen ab hier' }).tap();
      await expect(menue).toHaveCount(0);
      await expect(page.locator('[data-lfh="mess-steuerung"]')).toBeVisible();
      // Die Messsteuerung wächst als Band über die Karte (Handschuh: hoch) — die freie Mitte neu
      // bestimmen, sonst landete der Tipp auf dem Band.
      const mitteImModus = await kartenMitte(page);
      // Weit genug von der Druckstelle, damit die Strecke eine echte Länge hat.
      const zweiter = await freierPunktNahe(
        page,
        { x: mitteImModus.x + 60, y: mitteImModus.y },
        'zweiter Messpunkt',
        { fern: [frei], mindestens: 50 },
      );
      await page.waitForTimeout(400);
      const zweiterLl = await geoAm(page, zweiter);
      await tippe(page, zweiter);
      // Die Strecke beginnt an der DRUCKSTELLE: ihr Wert ist der Abstand Druckstelle → zweiter
      // Tipp, nicht bloß „irgendeine Zahl" (ein versetzter Startpunkt fiele hier auf).
      const erwartet = abstandM(druckLl, zweiterLl);
      await expect
        .poll(
          async () => {
            const text = (await page.locator('[data-lfh="messwert"]').textContent()) ?? '';
            const m = /([\d.,]+)\s*(km|m)\b/.exec(text.replace(/\u202f|\u00a0/g, ' '));
            if (!m) return NaN;
            const zahl = Number(m[1].replace(/\./g, '').replace(',', '.'));
            return (m[2] === 'km' ? zahl * 1000 : zahl) / erwartet;
          },
          { message: `Strecke ab der Druckstelle (~${Math.round(erwartet)} m)` },
        )
        .toBeGreaterThan(0.9);
      const text = (await page.locator('[data-lfh="messwert"]').textContent()) ?? '';
      const m = /([\d.,]+)\s*(km|m)\b/.exec(text.replace(/\u202f|\u00a0/g, ' '))!;
      const gemessen =
        Number(m[1].replace(/\./g, '').replace(',', '.')) * (m[2] === 'km' ? 1000 : 1);
      expect(gemessen / erwartet).toBeLessThan(1.1);

      // ── Im Messmodus öffnet ein langer Druck kein Menü ────────────────────────────────
      // Nicht auf einem der beiden Messpunkte: der Druck soll freie Karte treffen.
      const dritter = await freierPunktNahe(
        page,
        { x: mitteImModus.x - 50, y: mitteImModus.y },
        'langer Druck im Messmodus',
        { fern: [frei, zweiter], mindestens: 40 },
      );
      await langerDruck(page, cdp, dritter);
      await page.waitForTimeout(300);
      await expect(menue).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);

      expect(seitenFehler).toEqual([]);
    });

    test('Zeichen hier setzen; Marker und Zone', async ({ page }) => {
      test.setTimeout(150_000);
      if (dichte)
        await page.addInitScript(
          ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
          [DICHTE_SCHLUESSEL, dichte] as const,
        );
      await anmelden(page);
      const saat = await einsatzFuerKontext(page);
      await page.goto(`/einsaetze/${saat.einsatzId}/lagekarte`);
      await ruhe(page);
      const cdp = await page.context().newCDPSession(page);
      const menue = kontextMenue(page);
      const eintraege = menue.getByRole('menuitem');
      const auswahl = page.locator('[data-lfh="auswahl"] h3');

      // ── „Hier Zeichen setzen“: Dialog, Kachel per Tipp, „Setzen“ → Zeichen an der Stelle ──
      const frei = await stelleAufKarte(page, saat.frei, 'freie Stelle (Zeichen)');
      const druckLl = await page.evaluate(
        ({ x, y }) => {
          const k = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte;
          const r = k.getCanvas().getBoundingClientRect();
          return k.unproject([x - r.left, y - r.top]);
        },
        { x: frei.x, y: frei.y },
      );
      await langerDruck(page, cdp, frei);
      await expect(menue).toBeVisible();
      await eintraege.filter({ hasText: 'Hier Zeichen setzen' }).tap();
      const dialog = page.getByRole('dialog', { name: 'Zeichen hier setzen' });
      await expect(dialog).toBeVisible();
      // Am Touchschirm bleibt die Suche ohne Fokus (keine Bildschirmtastatur über dem Raster).
      await expect(dialog.getByLabel('Grundzeichen suchen')).not.toBeFocused();
      await dialog
        .getByRole('radiogroup', { name: 'Grundzeichen' })
        .getByRole('radio', { name: 'Person' })
        .tap();
      await dialog.getByRole('button', { name: 'Setzen' }).tap();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await (
              await page.request.get(`/api/einsaetze/${saat.einsatzId}/freie-zeichen`)
            ).json()) as { grundzeichen: string; lat: number; lon: number }[],
          { message: 'Zeichen ist an der Druckstelle gespeichert' },
        )
        .toEqual([
          expect.objectContaining({
            grundzeichen: 'person',
            lat: expect.closeTo(druckLl.lat, 4),
            lon: expect.closeTo(druckLl.lng, 4),
          }),
        ]);
      // Kein Platzier-Modus blieb stehen.
      await expect(page.locator('[data-lfh="platzier-steuerung"]')).toHaveCount(0);

      // ── Langer Druck auf einen Marker: kein Menü ─────────────────────────────────────
      const marker = await stelleAufKarte(page, EINZEL, 'Marker');
      await langerDruck(page, cdp, marker);
      await page.waitForTimeout(300);
      await expect(menue).toHaveCount(0);
      // Was ein Tipp danach öffnet (Inspector), ist nicht Teil der Aussage: zurück auf null.
      const schliessen = page.getByRole('button', { name: /schließen/i }).first();
      if (await schliessen.isVisible().catch(() => false)) await schliessen.click();

      // ── Langer Druck auf einen Kräfte-Cluster (DOM-Donut, keine Klickebene): kein Menü ──
      await springe(page, MITTE, ZOOM);
      // Wie im Tipp-Test oben: der Donut ist der DOM-Marker mit der Zahl der Traube.
      const donut = page.locator('.maplibregl-marker').filter({ hasText: '3' });
      await expect(donut).toHaveCount(1);
      const db = (await donut.boundingBox())!;
      const donutMitte = { x: db.x + db.width / 2, y: db.y + db.height / 2 };
      expect(
        await page.evaluate(
          ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.maplibregl-marker')),
          donutMitte,
        ),
        'der Finger liegt auf dem Donut',
      ).toBe(true);
      await page.waitForTimeout(400);
      await langerDruck(page, cdp, donutMitte);
      await page.waitForTimeout(300);
      await expect(menue).toHaveCount(0);
      const zuklappen = page.getByRole('button', { name: /schließen/i }).first();
      if (await zuklappen.isVisible().catch(() => false)) await zuklappen.click();

      // ── Langer Druck in die Zone: Menü, und das Abheben wählt die Zone nicht ─────────
      const zone = await stelleAufKarte(page, saat.inZone, 'Zone');
      await langerDruck(page, cdp, zone);
      await expect(menue).toBeVisible();
      await page.waitForTimeout(500);
      await expect(menue).toBeVisible();
      await expect(auswahl).toHaveCount(0);
      // Tipp daneben (frei, außerhalb der Zone) schließt ohne Wirkung eines Eintrags.
      const daneben = await freierPunktNahe(page, zone, 'Tipp daneben', { ausserhalb: saat.zone });
      await tippe(page, daneben);
      await expect(menue).toHaveCount(0);
      await expect(auswahl).toHaveCount(0);
      expect(
        (
          (await (
            await page.request.get(`/api/einsaetze/${saat.einsatzId}/freie-zeichen`)
          ).json()) as unknown[]
        ).length,
      ).toBe(1);
    });
  });
}

// Fükw: Rechtsklick öffnet dasselbe Menü; „Koordinate kopieren“ legt genau den Kopf in die
// Zwischenablage, Esc schließt und gibt den Fokus an die Karte.
test.describe('Kontextmenü per Rechtsklick am Fükw (LFH-776)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Rechtsklick, Koordinate kopieren, Esc', async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await anmelden(page);
    const saat = await einsatzFuerKontext(page);
    await page.goto(`/einsaetze/${saat.einsatzId}/lagekarte`);
    await ruhe(page);
    const menue = kontextMenue(page);

    const frei = await stelleAufKarte(page, saat.frei, 'freie Stelle (Maus)');
    await page.mouse.click(frei.x, frei.y, { button: 'right' });
    await expect(menue).toBeVisible();
    const kopf = (await kontextKopf(page).textContent())!.trim();
    expect(kopf).toMatch(/\d{3}/);
    await menue.getByRole('menuitem', { name: 'Koordinate kopieren' }).click();
    await expect(menue).toHaveCount(0);
    await expect(page.getByText('Koordinate kopiert')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(kopf);

    await page.mouse.click(frei.x, frei.y, { button: 'right' });
    await expect(menue).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="menu"]'))), {
        message: 'Fokus liegt im Menü',
      })
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(menue).toHaveCount(0);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeFocused();
  });
});
