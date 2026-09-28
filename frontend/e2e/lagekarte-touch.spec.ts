import { expect, test, type CDPSession, type Page } from '@playwright/test';

// LFH-713 (LFH-100 P5): die Lagekarte unter Touch, gemessen statt angenommen.
//
// Bis hierher galt für die Touch-Bedienung der Karte nur, was MapLibre per Vorgabe mitbringt,
// und kein Test lief mit `hasTouch`. Gate 1 misst den Querlauf bei 390 und 768 px, aber keine
// Bedienbarkeit; die gestapelten Fußbänder (LFH-355) waren nur bei 1024/1280/1440 px klickend
// belegt. Diese Datei fährt beide Führungskontexte mit Fingern: Handschirm (390 px) und
// Führungs-Tablet (1024 px).
//
// Jede Geste belegt ihre Wirkung am KARTENZUSTAND (`getZoom`/`getCenter`/`getBearing`/
// `getPitch`, Auswahl im Paneel, gespeicherte Zone), nie an einem Bildschirmfoto. Und jede
// Kartengeste startet hinter einer Trefferwache (`aufKarte`): ein Finger, der auf einem Band
// oder Knopf landet, bewegt die Karte nicht — die Aussage „keine Wirkung" wäre dann wertlos.
// Der Tipp auf den Donut und das Rollen der Zeitachse haben je eine eigene Wache.
//
// Die Mehrfinger-Gesten laufen über CDP `Input.dispatchTouchEvent`, weil Playwrights
// `touchscreen` nur einzelne Tipps kennt. Die Punkte tragen eine stabile `id`: MapLibre ordnet
// die Finger zwischen zwei Ereignissen über `identifier` zu.
//
// Zwei Befunde dieser Messung sind im selben Ticket behoben, und die Tests hier waren vorher rot:
//  - Ein senkrechter Zwei-Finger-Zug kippte die Karte auf 60°. Eine Lagekarte bleibt Draufsicht
//    (Entscheidung 25.09.2026): `touchPitch: false` + `maxPitch: 0` in `Kartenflaeche.tsx`.
//    Achtung beim Nachbauen: MapLibre kippt nur, wenn die Finger NEBENEINANDER liegen und sich
//    gemeinsam senkrecht bewegen — und nach OBEN; ein Zug nach unten deckelt bei Neigung 0 und
//    sähe auch ohne Abschaltung „ungekippt" aus. Deshalb die Positivkontrolle am Kartenzentrum.
//  - Bei 390 px blieb im Zeichenmodus mit ausgeklappter Zeitachse keine Karte zum Tippen: die
//    Leiste halbierte die Karte, der Fuß (412 px) deckte den Rest und ragte in den Seitenkopf.
//    Seit LFH-713 schließt die Werkzeugwahl unter `lg` die Leiste (`LagekartePage.tsx`), und
//    der Fuß endet an der Karte (`KartenFuss.tsx`).

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

// Ort der Lage. Drei Einheiten wenige Meter auseinander bilden bei Zoom 14 EINEN Kräfte-Cluster
// (DOM-Donut, fächert per Tipp auf); die vierte steht rund 670 m östlich, bei Zoom 14 gut
// 100 px vom Cluster entfernt, und bleibt ein Einzelzeichen (WebGL-Layer). Damit sind die drei
// Trefferwege der Karte abgedeckt: Einzelmarker, Donut, Spider-Leaf.
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

/** Einsatz mit der Traube und dem Einzelzeichen. Kein Modulname im Einsatznamen: die Palette
 *  sucht Module und Einsätze gemeinsam (siehe `lagekarte-smoke.spec.ts`). */
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
 * Donut. Ohne sie wäre „die Geste hat nicht gekippt" auch dann grün, wenn der Finger auf der
 * Zeitachse lag.
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
  // Der Fuß-Rahmen reicht bis zur Oberkante der Karte (LFH-713); frei ist nur, was über seinem
  // obersten BAND liegt.
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

      // ── Drehen: erlaubt, „Norden" holt die Ausrichtung zurück (Entscheidung 25.09.2026) ─
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
      // Positivkontrolle: die Geste KAM an — sie hat die Karte verschoben. Ohne diese Zeile
      // wäre „Neigung 0" auch dann grün, wenn die Finger nie die Karte erreicht hätten.
      expect(
        Math.abs(nachKippen.lat - vorKippen.lat),
        'Zwei-Finger-Zug erreicht die Karte',
      ).toBeGreaterThan(0.0005);

      // Die Draufsicht hängt nicht nur an der Geste: `maxPitch: 0` schließt auch die Tastatur
      // (Umschalt+↑ kippt in MapLibre um 10°). Positivkontrolle ist Umschalt+→, das dreht —
      // Drehen bleibt erlaubt, und es belegt, dass die Tasten die Karte erreichen.
      await springe(page, MITTE, ZOOM);
      await page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas').focus();
      // Jede Taste für sich abwarten: MapLibre rechnet den nächsten Schritt vom AKTUELLEN Stand,
      // eine schnell folgende Taste überschriebe die laufende Animation der vorigen.
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

      // Einzelzeichen (WebGL-Layer, Klickweg `map.on('click', layer)`). Wiederholt, bis die
      // Marker-Quelle steht — der erste Tipp kann vor dem ersten Render der Zeichen landen.
      // Ein Wiederholtipp ist hier harmlos: er wählt dasselbe Zeichen erneut.
      await expect(async () => {
        const p = await aufSchirm(page, EINZEL);
        await aufKarte(page, [p], 'Einzelzeichen');
        await tippe(page, p);
        await expect(ausgewaehlt(page).getByText('Pumpe Ost')).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      // Die Auswahl kann die Karte auf das Zeichen führen; jede Bewegung klappte einen Spider
      // zu. Also zurück auf den Blickpunkt, und erst tippen, wenn die Karte steht.
      await springe(page, ZWISCHEN, ZOOM);

      // Cluster: ein DOM-Donut über dem Canvas. Erst warten, bis er steht, dann GENAU EINMAL
      // tippen — ein zweiter Tipp schaltet den Spider wieder zu (Umschalten in `oeffne`).
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
      // Spider-Quelle selbst (Pixelversatz um den Cluster), nicht aus der Geokoordinate der
      // Einheit — die liegt unter dem Donut.
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
      // Abstand zum Donut-Tipp: zwei Tipps binnen 500 ms und 30 px wären ein Doppeltipp-Zoom,
      // und jede Bewegung klappt den Spider zu.
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

      // Vorbedingung wie im Smoke (LFH-355): die Bänder stapeln nur dann gegeneinander, wenn
      // die Zeitachse AUSGEKLAPPT steht. Unter `xl` startet sie eingeklappt — also einblenden,
      // wie es eine Einsatzkraft täte, und den Zustand zusichern, sonst wäre der Klick auf die
      // Bänder unten still wertlos statt rot.
      await page.getByRole('button', { name: 'Zeitachse einblenden' }).tap();
      await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();

      // Der Weg einer Einsatzkraft: „Zeichenwerkzeuge" auf der Karte öffnet die Leiste mit dem
      // Paneel „Zeichnen" — bei 390 px ist die Leiste sonst zu —, dort das Werkzeug wählen.
      const zeichnen = async () => {
        await page.getByRole('button', { name: 'Zeichenwerkzeuge' }).tap();
        await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).tap();
      };
      const abschliessen = page.getByRole('button', { name: 'Abschließen' });

      // ── Abbrechen wird GETIPPT, nicht nur gesehen (LFH-355: `toBeVisible` belegt keine
      // Klickbarkeit) ───────────────────────────────────────────────────────────────────────
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
        // Die Werkzeugwahl gibt die Karte frei (LFH-713): die Leiste schließt, die Karte hat
        // wieder die volle Höhe. Vorher halbierte die Leiste sie, und der Fuß deckte den Rest.
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
      // „Speichern" statt der Warnung „Mindestens 3 …": terra-draw hat die drei Tipps als
      // Punkte angenommen.
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
        // Die Serie hat das Werkzeug neu scharf geschaltet (Zeichen-Steuerung steht). Wer jetzt
        // die Leiste zurückholt, halbiert die Karte wieder, und der Fuß ist höher als sie.
        // Unten verankert und ohne Obergrenze ragte er gemessen 50 px über die Karte in den
        // Seitenkopf und deckte dort „Leiste ausblenden". Der Tipp auf genau diesen Knopf ist der
        // Beleg — `toBeVisible` wäre auch verdeckt grün (LFH-355).
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
        // Was nicht passt, gibt die Zeitachse ab und rollt in sich. Vorbedingung: sie ist hier
        // wirklich gestaucht, sonst prüfte das Rollen nichts.
        const zeitachseEl = page.locator('[data-lfh="zeitachse"]');
        const rollen = () =>
          zeitachseEl.evaluate((e) => ({
            oben: e.scrollTop,
            mehr: e.scrollHeight - e.clientHeight,
          }));
        expect((await rollen()).mehr, 'Zeitachse ist gestaucht').toBeGreaterThan(0);
        // Der Finger setzt im Polster des Bands auf, nicht auf Feld oder Schieberegler — ein
        // Tipp auf die Schiene schaltete sonst in den Historienmodus.
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
        // In genau diesem Zustand — Leiste offen, Fuß übervoll — bleiben das oberste Band und
        // der Seitenkopf bedienbar. Getippt, nicht gesehen: der Serien-Schalter oben im Fuß,
        // dann „Leiste ausblenden", das der Fuß vorher deckte.
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
