import { expect, test, type Page } from '@playwright/test';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorStilBeantworten,
} from './kartenFixture';

// Die Kartengrundlage der Lagekarte im Browser (LFH-558, Spec `lagekarte-kartengrundlage`).
// Alle drei Tests stellen ihre Grundlage selbst (`kartenFixture.ts`): kein Netz, keine echten Kacheln.
//
// (1) WECHSEL ZWISCHEN ZWEI ONLINE-VEKTORKARTEN über die Grundlage-Leiste, also über den
//     `[style]`-Effekt von `Kartenflaeche.tsx` (`setStyle` mit `diff: false`, dann die Neuanlage
//     über den Render-Poller). Die übrigen Stilwechsel-Tests fahren den Blindstil, der inline ist
//     und im selben Takt lädt; hier lädt der neue Style per URL, also erst nach dem Wechsel —
//     der Fall, für den die Neuanlage am Poller hängt und nicht an `styledata`.
//     Freie taktische Zeichen (`tz|`) bekommen ihr Bild über `styleimagemissing`: GEZÄHLT wird,
//     was in `marker-symbol` GEZEICHNET ist, nicht was registriert ist (Lehre aus LFH-835).
//
// (2) ABSTUFUNG ONLINE → OFFLINE: das Style-JSON der einzigen Online-Karte antwortet 404, die
//     Karte weicht auf die Offline-Region aus (`stilFehlerWaechter.ts`, `useKartenAnsicht`). Die
//     Wahl bleibt „online" (die Abstufung ändert nur die Anzeige). Die Stufe offline → blind ist
//     im Browser nicht herstellbar (Offline-Styles sind inline, `style.load` feuert sofort) und
//     bleibt beim Unit-Test.
//
// (3) ERSTSTIL OFFLINE (LFH-781): frische Seite mit nur einer Offline-Karte, s. dort.
//
// „Gelesen" heißt DEKODIERT (`querySourceFeatures`), nicht `loaded()` — s. `kartenFixture.ts`.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Einsatzort; alles Übrige liegt wenige hundert Meter darum, im Startausschnitt. */
const ORT = { lat: 49.3519, lon: 9.1457 };

/** Online-Views des Wechsels: eigene Style-Pfade, eigene Source-Ids, gemeinsame Kacheln. */
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';
const KACHEL_VORLAGE = `${KACHEL_PRAEFIX}{z}/{x}/{y}.pbf`;
const KACHEL_LAYER = 'strassen';
const VIEW_A = { name: 'Fixture A', stil: '/api/karte/proxy/9/a/style.json', quelle: 'fixture-a' };
const VIEW_B = { name: 'Fixture B', stil: '/api/karte/proxy/9/b/style.json', quelle: 'fixture-b' };

/** Die eigenen Quellen der Lagekarte, die nach einem Stilwechsel wieder befüllt sein müssen. */
const LAGE_QUELLEN = [
  'abschnitte',
  'zonen',
  'fachebene-dwd',
  'marker-cluster',
  'marker-einsatzort',
] as const;

/** Was die Specs vom Testhaken `window.__lfhKarte` brauchen — nachgebildet, nicht importiert. */
interface MapHaken {
  getStyle(): { sources?: Record<string, unknown> } | undefined;
  getSource(id: string): unknown;
  getLayer(id: string): unknown;
  isStyleLoaded(): boolean;
  isSourceLoaded(id: string): boolean;
  listImages(): string[];
  querySourceFeatures(id: string, optionen?: { sourceLayer: string }): unknown[];
  queryRenderedFeatures(optionen: { layers: string[] }): { properties: Record<string, unknown> }[];
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden(page: Page, methode: 'post' | 'patch', pfad: string, data: unknown) {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${methode} ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(
    true,
  );
  return (await antwort.json()) as { id: number } & Record<string, unknown>;
}

/** Einsatz mit Einsatzort über die API. Kein Modulname im Namen: die Kommandopalette durchsucht
 *  Module und Einsätze gemeinsam. */
async function einsatzMitOrt(page: Page, bezeichnung: string): Promise<number> {
  const e = await senden(page, 'post', '/api/einsaetze', { bezeichnung });
  await senden(page, 'patch', `/api/einsaetze/${e.id}`, {
    bezeichnung: e.bezeichnung,
    stichwort: e.stichwort ?? null,
    einsatzart: e.einsatzart,
    leitstellen_nr: e.leitstellen_nr ?? null,
    einsatzort: e.einsatzort ?? null,
    einsatzort_lat: ORT.lat,
    einsatzort_lon: ORT.lon,
    meldende_stelle: e.meldende_stelle ?? null,
    sachverhalt: e.sachverhalt ?? null,
    anzahl_betroffene_initial: e.anzahl_betroffene_initial ?? null,
    begonnen_at: e.begonnen_at,
  });
  return e.id;
}

/** Achsparalleles Rechteck um den Einsatzort, Kantenlängen in Grad. */
function rechteck(dLon: number, dLat: number, versatzLon = 0) {
  const w = ORT.lon + versatzLon - dLon;
  const o = ORT.lon + versatzLon + dLon;
  const s = ORT.lat - dLat;
  const n = ORT.lat + dLat;
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

/**
 * Zustand der Karte als ein vergleichbarer Satz: welche Grundlage-Quellen im Style stehen und ob
 * sie dekodiert sind, wie viele Features jede Lage-Quelle trägt und ob das freie Zeichen
 * gezeichnet ist. Während eines Stilwechsels (`isStyleLoaded()` false) liefert er `null`.
 */
function kartenStand(page: Page, grundQuellen: string[], grundLayer: string) {
  return page.evaluate(
    ({ grundQuellen, grundLayer, lageQuellen }) => {
      const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
      if (!map?.isStyleLoaded()) return null;
      const quellen = map.getStyle()?.sources ?? {};
      const grundlage: Record<string, string> = {};
      for (const id of grundQuellen) {
        if (!quellen[id]) grundlage[id] = 'fehlt';
        else
          grundlage[id] =
            map.querySourceFeatures(id, { sourceLayer: grundLayer }).length > 0
              ? 'dekodiert'
              : 'ungelesen';
      }
      const lage: Record<string, boolean> = {};
      for (const id of lageQuellen)
        lage[id] = !!map.getSource(id) && map.querySourceFeatures(id).length > 0;
      const zeichen = map.getLayer('marker-symbol')
        ? map
            .queryRenderedFeatures({ layers: ['marker-symbol'] })
            .filter((f) => f.properties.typ === 'freies_zeichen').length
        : 0;
      const tzBilder = map.listImages().filter((id) => id.startsWith('tz|')).length;
      return { grundlage, lage, zeichen, tzBilder };
    },
    { grundQuellen, grundLayer, lageQuellen: [...LAGE_QUELLEN] },
  );
}

const ALLE_LAGEQUELLEN_BEFUELLT = Object.fromEntries(LAGE_QUELLEN.map((id) => [id, true]));

test('Wechsel zwischen zwei Online-Vektorkarten: neue Grundlage gelesen, Lagebild und freies Zeichen wieder da', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));

  await kartenConfigBeantworten(page, {
    online_styles: [
      { name: VIEW_A.name, typ: 'vektor', url: VIEW_A.stil },
      { name: VIEW_B.name, typ: 'vektor', url: VIEW_B.stil },
    ],
  });
  for (const v of [VIEW_A, VIEW_B])
    await vektorStilBeantworten(page, v.stil, {
      id: v.quelle,
      kachelVorlage: KACHEL_VORLAGE,
      layer: KACHEL_LAYER,
    });
  await kachelnBeantworten(page, KACHEL_PRAEFIX, KACHEL_LAYER);
  // Fachebene ohne Netz: die DWD-Ebene liefert eine Warnfläche um den Einsatzort.
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
              geometry: rechteck(0.02, 0.01),
              properties: { event: 'STURMBÖEN', severity: 'Moderate' },
            },
          ],
        },
      },
    }),
  );

  await anmelden(page);
  const eid = await einsatzMitOrt(page, `E2E Grundlagewechsel ${Date.now()}`);
  const basis = `/api/einsaetze/${eid}`;
  await senden(page, 'post', `${basis}/zonen`, {
    typ: 'absperrbereich',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify(rechteck(0.002, 0.001, 0.003)),
    label: 'Sperrzone Wechsel',
  });
  const abschnitt = await senden(page, 'post', `${basis}/abschnitte`, { name: 'Deich Wechsel' });
  await senden(page, 'patch', `${basis}/abschnitte/${abschnitt.id}/flaeche`, {
    flaeche_geojson: JSON.stringify(rechteck(0.002, 0.001, -0.003)),
  });
  await senden(page, 'post', `${basis}/freie-zeichen`, {
    lat: ORT.lat + 0.001,
    lon: ORT.lon,
    grundzeichen: 'anlass',
    label: 'Zeichen Wechsel',
  });

  // Fachebenen-Paneel offen, damit der DWD-Schalter bedienbar ist.
  await page.addInitScript(() =>
    window.localStorage.setItem('lfh:lagekarte:paneele', JSON.stringify({ fachebenen: true })),
  );
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );
  const grundlage = page.getByRole('radiogroup', { name: 'Kartengrundlage' });
  await expect(grundlage.getByRole('radio', { name: VIEW_A.name })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page
    .locator('section[data-paneel="fachebenen"]')
    .getByRole('switch', { name: /DWD/ })
    .click();

  const grundQuellen = [VIEW_A.quelle, VIEW_B.quelle];
  // Vorher: A gelesen, B nicht im Style, das Lagebild vollständig, das Zeichen gezeichnet.
  await expect
    .poll(() => kartenStand(page, grundQuellen, KACHEL_LAYER), {
      timeout: 20_000,
      message: 'Ausgangslage nicht erreicht (Grundlage A, Lagebild, freies Zeichen)',
    })
    .toEqual({
      grundlage: { [VIEW_A.quelle]: 'dekodiert', [VIEW_B.quelle]: 'fehlt' },
      lage: ALLE_LAGEQUELLEN_BEFUELLT,
      zeichen: 1,
      tzBilder: 1,
    });

  // Der Wechsel über die Grundlage-Leiste — der echte `[style]`-Effekt, kein `setStyle` von außen.
  await grundlage.getByRole('radio', { name: VIEW_B.name }).click();
  await expect(grundlage.getByRole('radio', { name: VIEW_B.name })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await expect
    .poll(() => kartenStand(page, grundQuellen, KACHEL_LAYER), {
      timeout: 20_000,
      message:
        'nach dem Wechsel fehlt etwas — Verdacht: die Neuanlage nach `setStyle` lief nicht ' +
        '(Lagequelle leer), oder `styleimagemissing` erzeugt das `tz|`-Bild nicht (zeichen 0)',
    })
    .toEqual({
      grundlage: { [VIEW_A.quelle]: 'fehlt', [VIEW_B.quelle]: 'dekodiert' },
      lage: ALLE_LAGEQUELLEN_BEFUELLT,
      zeichen: 1,
      tzBilder: 1,
    });

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

/** Offline-Region der Abstufung: Pfadform wie `routes/karte.rs`, Shortbread-Layer `streets`. */
const OFFLINE = {
  kartenId: 7,
  kachelPraefix: '/api/karte/offline/7/tiles/',
  layer: 'streets',
} as const;
const ONLINE_KAPUTT = { name: 'Fixture kaputt', stil: '/api/karte/proxy/9/kaputt/style.json' };

test('Style-JSON der Online-Karte liefert 404: Anzeige weicht auf die Offline-Region aus, die Wahl bleibt online', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const abstufungen: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('Basemap-Style nicht ladbar')) abstufungen.push(m.text());
  });

  await kartenConfigBeantworten(page, {
    online_styles: [{ name: ONLINE_KAPUTT.name, typ: 'vektor', url: ONLINE_KAPUTT.stil }],
    offline_regionen: [
      {
        karte_id: OFFLINE.kartenId,
        name: 'Fixture-Region',
        tiles_url: `${OFFLINE.kachelPraefix}{z}/{x}/{y}?v=1`,
        format: 'vektor',
        maxzoom: 14,
      },
    ],
  });
  await page.route(`**${ONLINE_KAPUTT.stil}`, (route) =>
    route.fulfill({ status: 404, body: 'nicht da' }),
  );
  const offlineKacheln = await kachelnBeantworten(page, OFFLINE.kachelPraefix, OFFLINE.layer);

  await anmelden(page);
  const eid = await einsatzMitOrt(page, `E2E Abstufung ${Date.now()}`);
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );

  const offlineQuelle = `basemap-${OFFLINE.kartenId}`;
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ quelle, layer }) => {
            const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
            if (!map?.isStyleLoaded()) return 'Style lädt nicht (noch nicht, oder gar nicht)';
            const quellen = Object.keys(map.getStyle()?.sources ?? {});
            if (!quellen.includes(quelle)) return `keine Offline-Quelle im Style: ${quellen}`;
            return map.querySourceFeatures(quelle, { sourceLayer: layer }).length > 0
              ? 'offline dekodiert'
              : 'Offline-Quelle da, aber keine Kachel gelesen';
          },
          { quelle: offlineQuelle, layer: OFFLINE.layer },
        ),
      {
        timeout: 20_000,
        message: 'die Karte weicht nicht auf die Offline-Region aus',
      },
    )
    .toBe('offline dekodiert');
  expect(offlineKacheln.length).toBeGreaterThan(0);

  // Die Abstufung ändert nur die Anzeige: gewählt bleibt die Online-Karte.
  await expect(
    page
      .getByRole('radiogroup', { name: 'Kartengrundlage' })
      .getByRole('radio', { name: ONLINE_KAPUTT.name }),
  ).toHaveAttribute('aria-checked', 'true');
  // Genau EINE Abstufung: stufte die Karte weiter (etwa an einem Nebenabruf des Offline-Styles),
  // stünde dort eine zweite Warnung und die Offline-Quelle wäre weg. Eine spätere kann nicht mehr
  // kommen: die dekodierte Offline-Quelle setzt das `style.load` voraus, das das Fenster schließt.
  expect(abstufungen).toHaveLength(1);
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

/** Offline-Region des Erststils: eigene Karten-Id, damit sich die Routen nicht überschneiden. */
const OFFLINE_ERST = {
  kartenId: 8,
  kachelPraefix: '/api/karte/offline/8/tiles/',
  layer: 'streets',
} as const;

/** Stand der Offline-Grundlage als ein Wort (wie oben), `null`-frei für `expect.poll`. */
function offlineStand(page: Page, quelle: string, layer: string) {
  return page.evaluate(
    ({ quelle, layer }) => {
      const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
      if (!map?.isStyleLoaded()) return 'Style lädt nicht (noch nicht, oder gar nicht)';
      const quellen = Object.keys(map.getStyle()?.sources ?? {});
      if (!quellen.includes(quelle)) return `keine Offline-Quelle im Style: ${quellen}`;
      return map.querySourceFeatures(quelle, { sourceLayer: layer }).length > 0
        ? 'offline dekodiert'
        : 'Offline-Quelle da, aber keine Kachel gelesen';
    },
    { quelle, layer },
  );
}

/** Ein Bild aus `assets/karten/sprites/basemap.json`: steht es in der Karte, ist das Sprite da. */
const SPRITE_BILD = 'icon-airfield';

/** MapLibre-Fehler ohne Kachel seit dem Bau der Karte (`window.__lfhKartenFehler`, nur DEV). */
function kartenFehler(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __lfhKartenFehler?: string[] }).__lfhKartenFehler ?? null,
  );
}

// (3) ERSTSTIL OFFLINE (LFH-781): nur eine Offline-Karte, keine Online-Views. Die frische Seite
//     zeigt sofort Kacheln — kein Wechsel Blind → Offline nötig —, und weder der Erststil noch ein
//     späterer Wechsel meldet einen MapLibre-Fehler (Sprite-URL root-relativ, `isSourceLoaded`
//     auf `marker-cluster` vor der Neuanlage). Jeder Fehler ohne `tile` im ersten Fenster stufte
//     die Anzeige still auf „Blind", während die Leiste „Offline" zeigt. Mutationsprobe: ohne
//     `getSource` vor `isSourceLoaded` im Cluster-Poller (Stand vor LFH-558) bleibt die frische
//     Seite ohne Offline-Quelle — der Befund des Spikes LFH-720.
test('frische Seite mit aktiver Offline-Karte zeigt sofort Kacheln, ohne Kartenfehler, auch nach Blind → Offline', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const abstufungen: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('Basemap-Style nicht ladbar')) abstufungen.push(m.text());
  });

  await kartenConfigBeantworten(page, {
    offline_regionen: [
      {
        karte_id: OFFLINE_ERST.kartenId,
        name: 'Fixture-Region',
        tiles_url: `${OFFLINE_ERST.kachelPraefix}{z}/{x}/{y}?v=1`,
        format: 'vektor',
        maxzoom: 14,
      },
    ],
  });
  const kacheln = await kachelnBeantworten(page, OFFLINE_ERST.kachelPraefix, OFFLINE_ERST.layer);

  await anmelden(page);
  const eid = await einsatzMitOrt(page, `E2E Erststil ${Date.now()}`);
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
    1,
  );

  const quelle = `basemap-${OFFLINE_ERST.kartenId}`;
  const grundlage = page.getByRole('radiogroup', { name: 'Kartengrundlage' });
  await expect(grundlage.getByRole('radio', { name: 'Offline' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect
    .poll(() => offlineStand(page, quelle, OFFLINE_ERST.layer), {
      timeout: 20_000,
      message: 'die frische Seite zeigt die Offline-Karte nicht',
    })
    .toBe('offline dekodiert');
  expect(kacheln.length).toBeGreaterThan(0);
  // Das Sprite lädt (oder scheitert) erst nach `style.load`: warten, bis es in der Karte steht.
  await expect
    .poll(
      () =>
        page.evaluate((bild) => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          const fehler = (window as unknown as { __lfhKartenFehler?: string[] }).__lfhKartenFehler;
          return !!map?.listImages().includes(bild) || (fehler?.length ?? 0) > 0;
        }, SPRITE_BILD),
      { timeout: 10_000, message: 'das Sprite der Offline-Karte kommt nicht an' },
    )
    .toBe(true);
  expect(await kartenFehler(page)).toEqual([]);

  // Wechsel von Hand: Blind, dann wieder Offline — dieselbe Grundlage, wieder ohne Fehler.
  await grundlage.getByRole('radio', { name: 'Blind' }).click();
  await expect
    .poll(() => offlineStand(page, quelle, OFFLINE_ERST.layer), { timeout: 10_000 })
    .toMatch(/^keine Offline-Quelle im Style/);
  await grundlage.getByRole('radio', { name: 'Offline' }).click();
  await expect
    .poll(() => offlineStand(page, quelle, OFFLINE_ERST.layer), { timeout: 20_000 })
    .toBe('offline dekodiert');
  await expect
    .poll(
      () =>
        page.evaluate((bild) => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          return !!map?.listImages().includes(bild);
        }, SPRITE_BILD),
      { timeout: 10_000, message: 'das Sprite fehlt nach dem Wechsel' },
    )
    .toBe(true);
  expect(await kartenFehler(page)).toEqual([]);

  expect(abstufungen).toEqual([]);
  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
