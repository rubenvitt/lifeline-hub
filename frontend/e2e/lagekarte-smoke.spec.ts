import { expect, test, type Page } from '@playwright/test';

// Browser-Smoke der Lagekarte: das EINZIGE automatisierte Netz unter MapLibre/WebGL.
// `Kartenflaeche.tsx` ist die einzige Stelle mit `new maplibregl.Map`; die Unit-Tests stubben
// sie oder nutzen `fakeMap()`-Attrappen. jsdom hat weder Layout noch WebGL, Playwright-Chromium
// liefert WebGL2 via SwiftShader.
//
// `page.on('pageerror')` ist der Backstop für Fehler ohne DOM-Spur (Timer, Karten-Callback,
// async Handler). Ein Fehler im Render reißt dagegen den React-Root ab (keine ErrorBoundary um
// die Seite), und die DOM-Assertionen fallen.
//
// Deterministisch ohne Netzwerk: ohne konfigurierte Basemap fällt `baueBasemapStyle` auf
// `blindStyle` zurück, es wird nie eine Kachel geladen. Den Kachelpfad prüfen
// `lagekarte-kachelpfad.spec.ts` und `lagekarte-offline-precache.spec.ts`.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * Minimalausschnitt der MapLibre-Instanz, den `window.__lfhKarte` (DEV-Haken) bereitstellt.
 * Bewusst nicht der echte maplibre-Typ: ein Versionssprung soll den Test fachlich prüfen,
 * nicht typseitig mitreißen.
 */
interface MapHaken {
  getStyle(): { sources?: Record<string, unknown> } | undefined;
  isSourceLoaded(id: string): boolean;
  loaded(): boolean;
  isStyleLoaded(): boolean;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  listImages(): string[];
  getImage(id: string): { data: { width: number; height: number } } | null | undefined;
  setStyle(style: unknown, opts: { diff: boolean }): void;
  queryRenderedFeatures(o: { layers: string[] }): Array<{ properties: { typ?: string } }>;
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegenUndOeffnen(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  // Kein Modulname im Namen: die Kommandopalette durchsucht Module und Einsätze gemeinsam,
  // und ein „E2E Lagekarte …" ließ `command-palette.spec.ts` im strict mode flaken.
  await page.getByLabel('Bezeichnung').fill(`E2E Kartensmoke ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
}

/** Setzt die Einsatzort-Koordinate. Der Kopf-PATCH ist ein VOLLERSATZ (`KopfdatenUpdate`) — deshalb
 *  aus dem Bestand gebaut. */
async function einsatzortSetzen(page: Page, eid: number, ort: { lat: number; lon: number }) {
  const e = (await (await page.request.get(`/api/einsaetze/${eid}`)).json()) as Record<
    string,
    unknown
  >;
  const antwort = await page.request.patch(`/api/einsaetze/${eid}`, {
    data: {
      bezeichnung: e.bezeichnung,
      stichwort: e.stichwort ?? null,
      einsatzart: e.einsatzart,
      leitstellen_nr: e.leitstellen_nr ?? null,
      einsatzort: e.einsatzort ?? null,
      einsatzort_lat: ort.lat,
      einsatzort_lon: ort.lon,
      meldende_stelle: e.meldende_stelle ?? null,
      sachverhalt: e.sachverhalt ?? null,
      anzahl_betroffene_initial: e.anzahl_betroffene_initial ?? null,
      begonnen_at: e.begonnen_at,
    },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
}

/**
 * Zeichnen-Steuerung und Zeitachse dürfen sich nicht überlagern — mit echten Bounding-Boxen
 * (Vitest pinnt nur die Struktur). Überlappt ist nur, wenn sich BEIDE Achsen schneiden.
 */
async function ohneUeberdeckung(page: Page, wo: string) {
  const steuerung = page.locator('[data-lfh="karten-fuss"] > .ant-card');
  const zeitachse = page.locator('[data-lfh="zeitachse"]');
  const a = await steuerung.boundingBox();
  const b = await zeitachse.boundingBox();
  expect(a, `${wo}: Zeichnen-Steuerung hat keine Box`).not.toBeNull();
  expect(b, `${wo}: Zeitachse hat keine Box`).not.toBeNull();
  const ueberlappt =
    a!.x < b!.x + b!.width &&
    b!.x < a!.x + a!.width &&
    a!.y < b!.y + b!.height &&
    b!.y < a!.y + a!.height;
  expect(
    ueberlappt,
    `${wo}: Steuerung ${JSON.stringify(a)} überlappt Zeitachse ${JSON.stringify(b)}`,
  ).toBe(false);
  // In der gemeinten Richtung: die Steuerung steht ÜBER der Leiste.
  expect(a!.y + a!.height, `${wo}: Steuerung steht nicht über der Zeitachse`).toBeLessThanOrEqual(
    b!.y,
  );
}

test('Lagekarte: MapLibre startet, Controls leben, terra-draw greift', async ({ page }) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));

  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  await page.goto(`/einsaetze/${eid}/lagekarte`);

  // Anker statt Timeout: das Canvas erzeugt erst MapLibre, und die Seite zeigt bis zur
  // geladenen Karten-Config ein Spin.
  const karte = page.getByTestId('kartenflaeche');
  await expect(karte).toBeVisible();

  const canvas = karte.locator('canvas.maplibregl-canvas');
  // GENAU eins: unter Vite-Dev läuft der Map-Init-Effekt doppelt (StrictMode). Bliebe das
  // Cleanup (`map.remove()`) aus, stünden zwei Canvas im Container.
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();

  // Das Control-Gerüst lebt: die `AttributionControl` und die Maßstabsleiste im Kartenfuß
  // (sie trägt erst Text, wenn die Map ihr erstes `move` gerechnet hat).
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeAttached();
  await expect(page.locator('[data-lfh="massstab"] .maplibregl-ctrl-scale')).toHaveText(/\d/);
  await expect(page.getByRole('button', { name: 'Hineinzoomen' })).toBeVisible();

  // Arbeitet die Karte überhaupt? Alles oben ist auch bei totem Tile-Worker grün — und seit
  // maplibre 6 hängt der Worker an einer explizit verdrahteten URL (`setWorkerUrl`), deren
  // Fehlkonfiguration still durchläuft. `map.loaded()` verlangt geladenen Style UND Quellen,
  // und die GeoJSON-Quellen gehen zwingend durch den Worker.
  //
  // Nur `loaded()`, nicht „alle Quellen geladen": `isSourceLoaded` flapt bei jedem `setData`.
  // Die ungeladenen Quellen kommen als Diagnose in die Meldung. FALLE: `areTilesLoaded()` ist
  // bei stummem Worker TRUE und damit wertlos.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return 'kein Karten-Handle (window.__lfhKarte fehlt)';
          const quellen = Object.keys(map.getStyle()?.sources ?? {});
          // Zweiter, von maplibre entkoppelter Beleg: fast alle Quellen legt erst der
          // `load`-Handler an, und `load` feuert nur, wenn der Worker antwortet. Die Zahl
          // steigt monoton; die Schwelle ist bewusst locker.
          if (quellen.length < 2) return `nur ${quellen.length} Quelle(n): ${quellen.join(', ')}`;
          if (map.loaded()) return 'geladen';
          const ungeladen = quellen.filter((q) => !map.isSourceLoaded(q));
          return `map.loaded() ist false; ungeladen: ${ungeladen.join(', ') || '(keine)'}`;
        }),
      {
        timeout: 15_000,
        message: 'Karte wird nie fertig — Verdacht: maplibre-Worker antwortet nicht',
      },
    )
    .toBe('geladen');

  // VORBEDINGUNG: die Zeitachse steht ausgeklappt (Vorgabe ab `xl`, localStorage ungesetzt).
  // Fiele sie weg oder startete eingeklappt, wären die Überdeckungsmessungen still wertlos.
  await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();

  // terra-draw setzt beim Start den Cursor über `map.getCanvas().style.cursor` — der einzige
  // DOM-Beleg, dass der Adapter die Map übernommen hat. Die Knöpfe „Abschließen"/„Abbrechen"
  // kommen aus React-State und stünden auch bei wirkungslosem Adapter da.
  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
  await expect(canvas).toHaveCSS('cursor', 'crosshair');

  await ohneUeberdeckung(page, 'Desktop 1280 px');

  // Der eigentliche Beleg gegen die Überdeckung ist DIESER Klick: `toBeVisible()` ist in
  // Playwright kein Beleg für Klickbarkeit. Abbrechen fährt zugleich den Abbau des Adapters
  // (`removeLayer`/`removeSource`), eine eigene Bruchstelle.
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  // Führungs-Tablet 1024 × 768: ab `lg` steht die Leiste noch rechts neben der Karte; die
  // Zeichenwerkzeuge liegen im Paneel „Zeichnen" (für Schreibende vorgabemäßig offen).
  await page.setViewportSize({ width: 1024, height: 768 });
  // Unter `xl` startet die Zeitachse ohne gemerkte Wahl eingeklappt; die Messung braucht sie
  // ausgeklappt, also bewusst einblenden.
  await page.getByRole('button', { name: 'Zeitachse einblenden' }).click();
  await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();
  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
  await ohneUeberdeckung(page, 'Tablet 1024 px');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  // Handschirm 390 × 844: die Lagekarte bedient den Kontext „mobil" (LFH-557). Unter `lg` steht
  // die Leiste unter der Karte (am Handschirm per Vorgabe zu), und der Zeichenmodus gibt die Karte
  // frei (LFH-765); Steuerung und Zeitachse stapeln sich im Fuß über der Karte.
  await page.setViewportSize({ width: 390, height: 844 });
  // VORBEDINGUNG: die Zeitachse steht ausgeklappt (die Wahl bei 1024 px ist gemerkt).
  await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();
  await page.getByRole('button', { name: 'Leiste einblenden' }).click();
  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
  await expect(page.locator('#lagekarte-leiste')).toBeHidden();
  await ohneUeberdeckung(page, 'Handschirm 390 px');
  // Die Steuerung steht ganz im Bild, auch waagerecht (`minWidth: min(320px, 100%)`).
  await expect(page.locator('[data-lfh="karten-fuss"] > .ant-card')).toBeInViewport({ ratio: 1 });
  // Über dem Fuß bleibt Karte zum Zeichnen: das Ticket maß hier einmal null Kartenfläche.
  const kartenBox = (await canvas.boundingBox())!;
  const oberstesBand = (await page.locator('[data-lfh="karten-fuss"] > *').first().boundingBox())!;
  const frei = oberstesBand.y - Math.max(kartenBox.y, 0);
  const steuerHoehe = (await page.getByRole('button', { name: 'Abschließen' }).boundingBox())!
    .height;
  expect(
    frei,
    `Handschirm 390 px: über dem Kartenfuß bleiben ${frei}px Karte (Steuerhöhe ${steuerHoehe}px)`,
  ).toBeGreaterThanOrEqual(steuerHoehe * 4);
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

/**
 * Startansicht: ein verorteter Einsatz öffnet auf seinem Einsatzort. Im Browser, weil der
 * Fehler ein StrictMode-Fall war: der Start wurde auf der ersten, sofort entfernten Karte
 * verbraucht. Dazu: der Kartenfuß wächst mit ausgeklappter Zeitachse und einem gesicherten
 * Stand nicht über zwei Reihen.
 */
test('Lagekarte: startet auf dem Einsatzort; die Zeitachse deckt die Karte nicht zu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  const ort = { lat: 49.3519, lon: 9.1457 };
  await einsatzortSetzen(page, eid, ort);
  const stand = await page.request.post(`/api/einsaetze/${eid}/lage-snapshots`, {
    data: { bezeichnung: 'Stand vor Ort' },
  });
  expect(stand.ok(), await stand.text()).toBeTruthy();
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return null;
          const c = map.getCenter();
          return { zoom: Math.round(map.getZoom()), lat: c.lat, lon: c.lng };
        }),
      { timeout: 15_000, message: 'Karte steht nicht auf dem Einsatzort' },
    )
    .toEqual({ zoom: 14, lat: expect.closeTo(ort.lat, 4), lon: expect.closeTo(ort.lon, 4) });

  const zeitachse = page.locator('[data-lfh="zeitachse"]');
  await expect(zeitachse.getByRole('button', { name: 'Stand vor Ort' })).toBeVisible();
  const band = (await zeitachse.boundingBox())!;
  const zeile = (await page.getByRole('button', { name: 'Aktuell' }).boundingBox())!.height;
  // Die Stand-Reihe steht in der ersten Reihe des Bands. Der Fuß endet vor der Knopfspalte,
  // deshalb darf die Zeitleiste in eine zweite Reihe umbrechen; mehr als zwei wären ein Befund.
  const staende = (await zeitachse.locator('[data-lfh="zeitachse-staende"]').boundingBox())!;
  expect(
    staende.y - band.y,
    `die Stand-Reihe steht in der ersten Reihe des Bands (${staende.y - band.y}px unter der Oberkante)`,
  ).toBeLessThan(zeile);
  // Zwei Reihen = zwei Steuerhöhen plus Fuge (12 px) und Polsterung des Bands (2 × 8 px).
  expect(
    band.height,
    `Zeitachse ${band.height}px hoch bei ${zeile}px Zeilenhöhe — höchstens zwei Reihen`,
  ).toBeLessThanOrEqual(zeile * 2 + 12 + 16 + 1);

  // Unter `xl` startet die Zeitachse ohne gemerkte Wahl eingeklappt; zur Sicherheit geräumt.
  await page.evaluate(() => localStorage.removeItem('lfh:lagekarte:zeitachse-eingeklappt'));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Zeitachse einblenden' })).toBeVisible();
  await expect(page.locator('[data-lfh="zeitachse"]')).toHaveCount(0);
});

/**
 * Messwerkzeug: geprüft wird die Ereignisfolge des ECHTEN terra-draw (die Figur UND eigene
 * Hilfspunkte bei `create`, `finish`, Mitlaufen bei der Bewegung), die der Unit-Test von
 * `messZeichnung.ts` nur nachbaut.
 */
test('Lagekarte: Messwerkzeug misst Strecke und Fläche und schließt mit Escape', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));

  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);

  const knopf = page.getByRole('button', { name: 'Messen' });
  await knopf.click();
  await expect(knopf).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  const wert = page.locator('[data-lfh="messwert"]');
  await expect(wert).toHaveText('—');

  const box = (await canvas.boundingBox())!;
  const punkt = (dx: number, dy: number) => ({
    x: box.x + box.width / 2 + dx,
    y: box.y + box.height / 2 + dy,
  });

  // Strecke: zwei Punkte, der Wert läuft schon vor dem Abschluss mit.
  await page.mouse.click(punkt(-120, 0).x, punkt(-120, 0).y);
  await page.mouse.move(punkt(0, 0).x, punkt(0, 0).y, { steps: 4 });
  await expect(wert).toHaveText(/^\d[\d.,]* (m|km)$/);
  await page.mouse.click(punkt(0, 0).x, punkt(0, 0).y);
  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();
  await expect(wert).toHaveText(/^\d[\d.,]* (m|km)$/);

  // Kartenwechsel mitten in einer Messung: „Hell" ergibt `setStyle` mit `diff: false`, das die
  // Sources des Adapters wegwirft. Erwartet: die Messung beginnt in derselben Form neu.
  await page.mouse.click(punkt(-120, 40).x, punkt(-120, 40).y);
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: /Hell/ }).click();
  await expect(wert).toHaveText('—');
  await page.mouse.click(punkt(-120, -40).x, punkt(-120, -40).y);
  await page.mouse.move(punkt(60, -40).x, punkt(60, -40).y, { steps: 4 });
  await expect(wert).toHaveText(/^\d[\d.,]* (m|km)$/);
  await page.mouse.click(punkt(60, -40).x, punkt(60, -40).y);
  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();

  // Fläche: alle Punkte ÜBER der Mitte — darunter liegt das Mess-Band im Kartenfuß.
  await page.getByRole('radio', { name: 'Fläche' }).click();
  await expect(wert).toHaveText('—');
  for (const [dx, dy] of [
    [-100, -120],
    [100, -120],
    [0, -20],
  ]) {
    await page.mouse.click(punkt(dx, dy).x, punkt(dx, dy).y);
  }
  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();
  await expect(wert).toHaveText(/(m²|ha|km²)\s*Umfang \d/);

  // Direkt aus dem Messen ins Zeichnen: drei terra-draw-Instanzen auf EINER Karte brauchen
  // eigene Präfixe, sonst wirft MapLibre „Source … already exists".
  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
  await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);
  await expect(knopf).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  // Escape beendet das Werkzeug, der Knopf springt zurück.
  await knopf.click();
  await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);
  await expect(knopf).toHaveAttribute('aria-pressed', 'false');

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

// LFH-841: Die Beschriftungsplaketten (`plakette|…`, 9-Slice) legt der Bild-Resolver an, nicht mehr
// `styleimagemissing`. Dort angelegt, fehlten sie im laufenden Layout (MapLibre 6 baut die
// Bildantwort einer Kachel, BEVOR es das Event feuert) und nach einem Stilwechsel ohne neue Daten
// ganz. Den Fehlgriff verrät MapLibres Warnung „Image … could not be loaded“: sie fällt genau dann,
// wenn ein Bild zur Layoutzeit fehlte — gezählte Features allein unterscheiden das nicht, weil der
// Text auch ohne Plakette steht.
test('Lagekarte: Beschriftungsplaketten stehen sofort, auch nach einem Stilwechsel', async ({
  page,
}) => {
  const fehlbilder: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('could not be loaded')) fehlbilder.push(m.text());
  });
  await anmelden(page);
  const eid = await einsatzAnlegenUndOeffnen(page);
  const ort = { lat: 49.3519, lon: 9.1457 };
  await einsatzortSetzen(page, eid, ort);
  // Eine Schadenstelle neben dem Einsatzort: im Bild bei Zoom 14, nicht im selben Cluster.
  const r = await page.request.post(`/api/einsaetze/${eid}/schaeden`, {
    data: {
      typ: 'sachschaden',
      ausmass: 'mittel',
      ort: 'Schadenstelle Nord',
      lat: ort.lat + 0.0028,
      lon: ort.lon + 0.004,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );

  const plaketten = () =>
    page.evaluate(() => {
      const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
      // Während eines Stilwechsels wirft `listImages` („Style is not done loading“): weiterpollen.
      if (!map?.isStyleLoaded()) return null;
      return {
        bilder: map.listImages().filter((id) => id.startsWith('plakette|')).length,
        // Registriert ist nicht gezeichnet: die Beschriftung muss im Layer stehen.
        gezeichnet: map.queryRenderedFeatures({
          layers: ['marker-label', 'marker-einsatzort-label'],
        }).length,
      };
    });

  // Eine Bild-Id je Farbpaar: Einsatzort und Schaden teilen sich die Plakette.
  await expect
    .poll(plaketten, { timeout: 15_000, message: 'keine Beschriftungsplakette gezeichnet' })
    .toEqual({ bilder: 1, gezeichnet: 2 });

  // Ein Grundkarten-/Themenwechsel setzt den Stil neu (`diff: false`) und wirft alle Bilder weg.
  await page.evaluate(() => {
    const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte!;
    map.setStyle(map.getStyle(), { diff: false });
  });
  await expect
    .poll(plaketten, { timeout: 15_000, message: 'Plaketten nach dem Stilwechsel nicht zurück' })
    .toEqual({ bilder: 1, gezeichnet: 2 });

  expect(fehlbilder.filter((t) => t.includes('plakette|'))).toEqual([]);
});

// LFH-835: Fachobjekt-Zeichen kommen aus @einsatzzeichen, synchron über Canvas gerastert —
// jsdom hat kein Canvas, das belegt nur der Browser. Pixeldichte 2 → 34 CSS-px = 68 Gerätepixel.
test.describe('Lagekarte: Fachobjekt-Zeichen', () => {
  test.use({ deviceScaleFactor: 2 });

  /** Die `ez|`-Bilder der Karte mit Rasterbreite, und ob das Einsatzort-Zeichen gezeichnet ist. */
  const einsatzortZeichen = (page: Page) =>
    page.evaluate(() => {
      const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
      // Während eines Stilwechsels wirft `listImages` („Style is not done loading“): weiterpollen.
      if (!map?.isStyleLoaded()) return null;
      return map
        .listImages()
        .filter((id) => id.startsWith('ez|'))
        .map((id) => ({
          id,
          breite: map.getImage(id)?.data.width,
          // Registriert ist nicht gezeichnet: das Symbol muss im Layer stehen.
          gezeichnet: map.queryRenderedFeatures({ layers: ['marker-einsatzort-symbol'] }).length,
        }));
    });

  test('Einsatzort-Zeichen in Bildschirmschärfe, auch nach einem Stilwechsel', async ({ page }) => {
    await anmelden(page);
    const eid = await einsatzAnlegenUndOeffnen(page);
    await einsatzortSetzen(page, eid, { lat: 49.3519, lon: 9.1457 });
    await page.goto(`/einsaetze/${eid}/lagekarte`);
    await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
      1,
    );

    const zeichenBilder = () => einsatzortZeichen(page);

    await expect
      .poll(zeichenBilder, { timeout: 15_000, message: 'kein @einsatzzeichen-Bild auf der Karte' })
      .toEqual([{ id: 'ez|{"v":1,"spec":{"kind":"event"}}', breite: 68, gezeichnet: 1 }]);

    // Ein Grundkarten-/Themenwechsel setzt den Stil neu (`diff: false`) und wirft alle Bilder weg.
    await page.evaluate(() => {
      const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte!;
      map.setStyle(map.getStyle(), { diff: false });
    });
    await expect
      .poll(zeichenBilder, { timeout: 15_000, message: 'Zeichen nach Stilwechsel nicht zurück' })
      .toEqual([{ id: 'ez|{"v":1,"spec":{"kind":"event"}}', breite: 68, gezeichnet: 1 }]);
  });

  // LFH-842: Wandert das Fenster auf einen Monitor anderer Dichte (oder ändert sich der Zoom),
  // rastern die schon angelegten Zeichen neu: Breite 34 × ceil(dpr). Den Wechsel stellt der Test
  // so nach, wie ihn der Browser meldet: `devicePixelRatio` springt, und die `resolution`-Abfrage
  // auf die alte Dichte meldet `change`. Nicht über CDP-Emulation
  // (`Emulation.setDeviceMetricsOverride` aus einer zweiten Sitzung): unter dem Chromium der CI
  // rasterte danach nichts neu, lokal schon — der Test hinge an der Emulation statt an der Karte.
  // Zweimal, damit auch der zweite Wechsel ankommt (die Karte meldet sich je Wechsel neu an).
  test('Zeichen rastern nach einem Wechsel der Pixeldichte neu', async ({ page }) => {
    await page.addInitScript(() => {
      const echt = window.matchMedia.bind(window);
      const abfragen: { media: string; mql: MediaQueryList }[] = [];
      window.matchMedia = (media: string) => {
        const mql = echt(media);
        abfragen.push({ media, mql });
        return mql;
      };
      (window as unknown as { __lfhDichte: (neu: number) => void }).__lfhDichte = (neu) => {
        const alt = `(resolution: ${window.devicePixelRatio}dppx)`;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: neu });
        for (const a of abfragen) if (a.media === alt) a.mql.dispatchEvent(new Event('change'));
      };
    });
    await anmelden(page);
    const eid = await einsatzAnlegenUndOeffnen(page);
    await einsatzortSetzen(page, eid, { lat: 49.3519, lon: 9.1457 });
    await page.goto(`/einsaetze/${eid}/lagekarte`);
    await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
      1,
    );
    const id = 'ez|{"v":1,"spec":{"kind":"event"}}';
    await expect
      .poll(() => einsatzortZeichen(page), { timeout: 15_000 })
      .toEqual([{ id, breite: 68, gezeichnet: 1 }]);

    for (const [dichte, breite] of [
      [1, 34],
      [1.5, 68],
    ]) {
      await page.evaluate(
        (d) => (window as unknown as { __lfhDichte: (neu: number) => void }).__lfhDichte(d),
        dichte,
      );
      await expect
        .poll(() => einsatzortZeichen(page), {
          timeout: 15_000,
          message: `Zeichen nicht in Dichte ${dichte} neu gerastert`,
        })
        .toEqual([{ id, breite, gezeichnet: 1 }]);
    }
  });

  // Gezählt wird, was GEZEICHNET ist, nicht, was registriert ist: MapLibre 6 baut die Bildantwort
  // einer Kachel, bevor es `styleimagemissing` feuert — ein erst dort angelegtes Bild fehlte im
  // laufenden Layout, und nach einem Stilwechsel kommt ohne neue Daten kein weiteres Layout.
  test('jedes Schadenszeichen ist gezeichnet, auch nach einem Stilwechsel', async ({ page }) => {
    await anmelden(page);
    const eid = await einsatzAnlegenUndOeffnen(page);
    const ort = { lat: 49.3519, lon: 9.1457 };
    await einsatzortSetzen(page, eid, ort);
    // Je ein Quadrant um den Einsatzort: im Bild bei Zoom 14, und weit genug auseinander, dass
    // nichts zum Cluster zusammenfällt (clusterRadius 45 px).
    const lagen = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [i, ausmass] of ['gering', 'mittel', 'gross', 'katastrophal'].entries()) {
      const r = await page.request.post(`/api/einsaetze/${eid}/schaeden`, {
        data: {
          typ: 'sachschaden',
          ausmass,
          ort: `Schadenstelle ${i + 1}`,
          lat: ort.lat + 0.0028 * lagen[i][0],
          lon: ort.lon + 0.004 * lagen[i][1],
        },
      });
      expect(r.ok(), await r.text()).toBeTruthy();
    }
    await page.goto(`/einsaetze/${eid}/lagekarte`);
    await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
      1,
    );
    const gezeichnet = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
        if (!map) return null;
        return map
          .queryRenderedFeatures({ layers: ['marker-symbol'] })
          .filter((f) => f.properties.typ === 'schaden').length;
      });
    await expect
      .poll(gezeichnet, { timeout: 10_000, message: 'nicht jedes Schadenszeichen ist gezeichnet' })
      .toBe(4);

    await page.evaluate(() => {
      const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte!;
      map.setStyle(map.getStyle(), { diff: false });
    });
    await expect
      .poll(gezeichnet, { timeout: 10_000, message: 'nach dem Stilwechsel fehlen Zeichen' })
      .toBe(4);
  });
});
