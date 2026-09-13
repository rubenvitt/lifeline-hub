import { expect, test, type Page, type Route } from '@playwright/test';

// Der echte Kachel-Pfad der Lagekarte (LFH-356/1) — die Hälfte, die `lagekarte-smoke.spec.ts`
// bewusst NICHT abdeckt.
//
// Warum es diese Datei gibt: der Smoke fährt auf einer frischen Temp-DB ohne konfigurierte
// Basemap, `baueBasemapStyle` fällt auf `blindStyle` zurück (`sources: {}`). Deterministisch und
// schnell — aber es wird dabei NIE eine Kachel geholt. Ungeprüft blieb damit die Kette
// „Style-JSON → substituierte Kachel-URL → `transformRequest` → fetch IM WORKER → Parsen",
// und genau die ist schon einmal gebrochen (LFH-182: root-relative Proxy-URLs ohne
// Dokument-Base im Tile-Worker) und von maplibre 6 angefasst worden (neue Worker-Verdrahtung
// über `setWorkerUrl`).
//
// DIE QUELLE STELLT DER TEST SELBST. Kein Tile-Server, kein Seed, kein Netz: `page.route`
// beantwortet `/api/karte/config` mit einem Online-VEKTOR-View, dessen Style-JSON mit einer
// Vector-Source und die Kacheln mit 33 Bytes handgeschriebenem Protobuf — einer echten,
// minimalen Vector-Tile (Aufbau und Begründung an `KACHEL_BYTES`). Und `page.route` greift auch
// für die Anfragen des maplibre-WORKERS (gemessen: 4 von 4 Kacheln abgefangen) — das war die
// offene Frage aus dem Ticket („Route-Stub oder Fixture-Backend").
//
// VEKTOR, NICHT RASTER, und das ist keine Geschmacksfrage: Raster-Kacheln lädt maplibre auf dem
// Hauptthread. Nur eine Vector-Source schickt die Anfrage durch den Worker — also durch die
// Bruchstelle, um die es geht.
//
// DIE TRAGENDE ZUSICHERUNG IST DER MITSCHNITT, NICHT DIE NETZ-WIRKUNG (gemessen, und es
// korrigiert die naheliegende Annahme des Tickets): mit ENTFERNTEM `transformRequest` in
// `Kartenflaeche.tsx` lief dieser Fixture-Lauf unverändert durch — 4 Kachel-Anfragen, alle
// absolut, `map.loaded()` true. maplibre 6 fetcht im Worker über `new Request(url)`, und das
// löst eine root-relative URL gegen `self.location` des Worker-Skripts auf; das liegt
// same-origin, es kommt dasselbe heraus. Ein Test, der nur „eine Kachel wurde geholt" prüft,
// wäre also grün, ohne dass `absolutiereProxyAnfrage` je liefe — er könnte nicht rot werden.
// Deshalb trägt die Zusicherung `window.__lfhKartenAnfragen` (DEV-Haken neben `__lfhKarte`,
// Begründung dort): sie zeigt Eingabe UND Ausgabe des Seams. Mutationsproben:
// `transformRequest` entfernt → Liste leer → rot; `absolutiereProxyAnfrage` auf Durchreiche
// gestellt → `aus === ein` → rot.
//
// Die Netz-Assertionen bleiben daneben stehen, weil sie etwas ANDERES belegen: dass die
// absolutierte URL wirklich abgesetzt und die Antwort vom Worker gelesen wurde. Bei totem
// Worker (gemessen im Smoke) bliebe die Quelle ungeladen.
//
// UND „GELESEN" HEISST DEKODIERT, NICHT `loaded()`. Auch das ist gemessen und korrigiert den
// ersten Anlauf: mit Müll statt Protobuf als Kachel-Körper blieb dieser Test grün. MapLibre
// führt eine gescheiterte Kachel als `errored`, und `isSourceLoaded()`/`loaded()` zählen das wie
// geladen (die Mechanik steht im Kopf von `stilFehlerWaechter.ts`); der Kachel-Fehler kommt als
// `error`-Event, nicht als Ausnahme, also bleibt `pageerror` ebenfalls leer. Die Zusicherung
// hängt deshalb an `querySourceFeatures` — ein Merkmal entsteht nur aus gelesenen Bytes.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Root-relative Kachel-Vorlage wie sie das Backend liefert (`/api/karte/proxy/…`, LFH-182). */
const KACHEL_VORLAGE = '/api/karte/proxy/9/tile/{z}/{x}/{y}.pbf';
const STIL_PFAD = '/api/karte/proxy/9/style.json';
/** Präfix der substituierten Kachel-URLs — ohne Platzhalter, so wie MapLibre sie anfragt. */
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';
/** Name des Layers IM Kachel-Körper; muss zum `source-layer` des Fixture-Styles passen. */
const KACHEL_LAYER = 'strassen';

/**
 * Eine echte, minimale Mapbox-Vector-Tile: ein Layer `strassen` mit EINER LineString-Geometrie.
 *
 * WARUM VON HAND UND NICHT LEER (gemessen, und es korrigiert den ersten Anlauf dieses Specs):
 * ein leerer Körper ist eine gültige LEERE Vector-Tile — damit war „die Kachel wurde geparst"
 * nicht prüfbar, und schlimmer: mit ausgesprochenem MÜLL als Körper (`'KEIN PROTOBUF …'`) blieb
 * der Test grün. MapLibre führt eine gescheiterte Kachel als `errored`, und sowohl
 * `isSourceLoaded()` als auch `loaded()` zählen `errored` wie `loaded` (dieselbe Mechanik, die
 * `stilFehlerWaechter.ts` im Kopf beschreibt); der Kachel-Fehler läuft als `error`-Event, nicht
 * als Ausnahme, also bleibt auch `pageerror` leer. Geprüft wird deshalb ein DEKODIERTES
 * MERKMAL (`querySourceFeatures`) — das entsteht nur, wenn der Worker die Bytes wirklich gelesen
 * hat.
 *
 * KEINE neue Abhängigkeit dafür: 33 Bytes Protobuf sind billiger als eine Kachel-Bibliothek im
 * Testpfad, und die Bytes können nicht still verrotten — sind sie falsch, findet
 * `querySourceFeatures` nichts und der Test wird rot. Aufbau (vector_tile.proto):
 *   1A 1F                        Tile.layers (Feld 3, Länge 31)
 *     78 02                      Layer.version = 2            (Feld 15)
 *     0A 08 'strassen'           Layer.name                   (Feld 1)
 *     12 0E                      Layer.features (Feld 2, Länge 14)
 *       08 01                    Feature.id = 1               (Feld 1)
 *       18 02                    Feature.type = LINESTRING    (Feld 3)
 *       22 08 …                  Feature.geometry, gepackt    (Feld 4)
 *            09                  MoveTo, 1×
 *            00 00               dx=0, dy=0       (Zickzack)
 *            0A                  LineTo, 1×
 *            C8 01 C8 01         dx=+100, dy=+100 (Zickzack 200)
 *     28 80 20                   Layer.extent = 4096          (Feld 5)
 * Ohne `tags` braucht die Kachel weder `keys` noch `values`.
 */
const KACHEL_BYTES = Buffer.from([
  0x1a, 0x1f,
  // Layer
  0x78, 0x02, 0x0a, 0x08, 0x73, 0x74, 0x72, 0x61, 0x73, 0x73, 0x65, 0x6e,
  // Feature
  0x12, 0x0e, 0x08, 0x01, 0x18, 0x02, 0x22, 0x08, 0x09, 0x00, 0x00, 0x0a, 0xc8, 0x01, 0xc8, 0x01,
  // extent
  0x28, 0x80, 0x20,
]);

/** Ausschnitt des DEV-Mitschnitts aus `Kartenflaeche.tsx`. Bewusst hier nachgebildet statt aus
 *  `src/` importiert: der Spec-Ordner bindet nicht gegen die Anwendung. */
interface KartenAnfrage {
  ein: string;
  aus: string;
}

interface MapHaken {
  getStyle(): { sources?: Record<string, unknown> } | undefined;
  isSourceLoaded(id: string): boolean;
  loaded(): boolean;
  querySourceFeatures(id: string, optionen: { sourceLayer: string }): unknown[];
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz über die API anlegen — kürzer und unempfindlicher als der Klickweg, und der Name
 *  trägt KEINEN Modulnamen: die Kommandopalette durchsucht Module und Einsätze in derselben
 *  Optionsliste, ein „…Lagekarte…" ließe command-palette.spec.ts strict-mode-verletzen. */
async function einsatzAnlegen(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Kachelpfad ${Date.now()}` },
  });
  expect(antwort.ok(), `POST /api/einsaetze: ${antwort.status()} ${await antwort.text()}`).toBe(
    true,
  );
  return ((await antwort.json()) as { id: number }).id;
}

test('Lagekarte: Kachel-Pfad — absolutiereProxyAnfrage läuft, der Worker holt und parst', async ({
  page,
}) => {
  // Vorbedingung als Zusicherung, nicht als Annahme: die Fixture MUSS root-relativ sein, sonst
  // prüft der Test die Absolutierung nicht mehr — und niemand würde es merken.
  expect(KACHEL_VORLAGE.startsWith('/'), 'Kachel-Vorlage muss root-relativ sein').toBe(true);
  expect(KACHEL_VORLAGE.startsWith('//'), 'protokoll-relativ ist ausgenommen (LFH-182)').toBe(
    false,
  );

  const seitenFehler: Error[] = [];
  page.on('pageerror', (fehler) => seitenFehler.push(fehler));

  /** Die URLs, mit denen der Worker die Kacheln tatsächlich angefragt hat. */
  const kachelAnfragen: string[] = [];
  await page.route('**/api/karte/config', (route: Route) =>
    route.fulfill({
      json: {
        karten_bau_verfuegbar: false,
        offline_regionen: [],
        offline_verfuegbar: false,
        // Ein Online-View macht `defaultModus` zu 'online' (basemapAuswahl.ts) — damit
        // konstruiert die Karte direkt mit dem Kachel-Style statt mit blindStyle.
        online_styles: [{ name: 'Kachel-Fixture', typ: 'vektor', url: STIL_PFAD }],
      },
    }),
  );
  await page.route(`**${STIL_PFAD}`, (route: Route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          fixture: { type: 'vector', tiles: [KACHEL_VORLAGE], minzoom: 0, maxzoom: 14 },
        },
        layers: [
          { id: 'fixture-grund', type: 'background', paint: { 'background-color': '#e8e8e8' } },
          // Ohne einen Layer AUF der Source fragt MapLibre keine Kachel an.
          { id: 'fixture-linien', type: 'line', source: 'fixture', 'source-layer': KACHEL_LAYER },
        ],
      },
    }),
  );
  await page.route(`**${KACHEL_PRAEFIX}**`, (route: Route) => {
    kachelAnfragen.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/x-protobuf',
      body: KACHEL_BYTES,
    });
  });

  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);

  await expect(page.getByTestId('kartenflaeche')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);

  // (1) AK „absolutiereProxyAnfrage wird nachweislich ausgeführt": der Seam hat für eine
  //     KACHEL-URL gelaufen, und er hat sie absolutiert. Geprüft wird das Paar ein→aus, nicht
  //     bloß die Anwesenheit eines Eintrags — eine Durchreiche wäre sonst nicht unterscheidbar.
  const erwarteteHerkunft = new URL(page.url()).origin;
  await expect
    .poll(
      () =>
        page.evaluate((praefix) => {
          const liste =
            (window as unknown as { __lfhKartenAnfragen?: KartenAnfrage[] }).__lfhKartenAnfragen ??
            [];
          const kacheln = liste.filter((a) => a.ein.startsWith(praefix));
          if (kacheln.length === 0)
            return `keine Kachel-Anfrage im Mitschnitt (${liste.length} Einträge insgesamt: ${liste
              .map((a) => a.ein)
              .join(', ')})`;
          return JSON.stringify(kacheln[0]);
        }, KACHEL_PRAEFIX),
      {
        timeout: 20_000,
        message:
          'transformRequest lief für keine Kachel — Verdacht: die Option fehlt an der Map, ' +
          'oder die Karte kam nie zum Kachel-Laden',
      },
    )
    .not.toContain('keine Kachel-Anfrage');

  const mitschnitt: KartenAnfrage[] = await page.evaluate(
    () =>
      (window as unknown as { __lfhKartenAnfragen?: KartenAnfrage[] }).__lfhKartenAnfragen ?? [],
  );
  const kachelSeam = mitschnitt.filter((a) => a.ein.startsWith(KACHEL_PRAEFIX));
  expect(kachelSeam.length).toBeGreaterThan(0);
  for (const anfrage of kachelSeam) {
    // Die eigentliche Aussage: root-relativ rein, absolut gegen die Origin raus.
    expect(anfrage.aus, `Kachel-URL nicht absolutiert: ${anfrage.ein}`).toBe(
      erwarteteHerkunft + anfrage.ein,
    );
  }

  // (2) Die absolutierte URL wurde auch wirklich abgesetzt — mit genau dieser Origin.
  //     GEWARTET, nicht bloß behauptet: der Mitschnitt oben entsteht auf dem HAUPTTHREAD, bevor
  //     MapLibre den Worker-Fetch abschickt. Die Poll-Bedingung (1) kann also erfüllt sein,
  //     während `page.route` noch nichts gesehen hat — eine synchrone Prüfung hier wäre ein
  //     Rennen, das nur auf einer langsamen/belasteten Maschine verliert.
  await expect
    .poll(() => kachelAnfragen.length, {
      timeout: 20_000,
      message: 'keine Kachel-Anfrage am Netz angekommen',
    })
    .toBeGreaterThan(0);
  // Momentaufnahme: die Liste wächst weiter, während darüber iteriert wird.
  for (const url of [...kachelAnfragen]) {
    expect(url.startsWith(`${erwarteteHerkunft}${KACHEL_PRAEFIX}`), `Kachel-URL: ${url}`).toBe(
      true,
    );
    // Platzhalter müssen substituiert sein: eine percent-kodierte `%7Bz%7D` ist der Fehler,
    // gegen den `absolutiereProxyAnfrage` bewusst auf String-Konkatenation statt `new URL()`
    // setzt (basemapStil.ts) — MapLibre substituiert sie dann nie und holte 0 Kacheln.
    expect(url).not.toContain('%7B');
    expect(url).not.toContain('{');
  }

  // (3) Und der Worker hat die Antwort GELESEN. Das ist der Teil, den keine URL-Prüfung zeigt:
  //     bei totem Worker bleibt die Quelle ungeladen, während Canvas und Controls unverändert
  //     dastehen (im Smoke gemessen).
  //     Die tragende Zeile ist das DEKODIERTE MERKMAL, nicht `loaded()`: eine gescheiterte
  //     Kachel gilt MapLibre als `errored`, und das zählt in `isSourceLoaded()`/`loaded()` wie
  //     geladen. Gemessen mit Müll statt Protobuf als Körper — ohne die Merkmalsprüfung blieb
  //     dieser Test grün (Begründung und Byte-Aufbau oben an KACHEL_BYTES).
  await expect
    .poll(
      () =>
        page.evaluate((kachelLayer) => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          if (!map) return 'kein Karten-Handle (window.__lfhKarte fehlt)';
          if (!map.getStyle()?.sources?.fixture) return 'Fixture-Quelle fehlt im Style';
          if (!map.isSourceLoaded('fixture')) return 'Fixture-Quelle ungeladen';
          if (!map.loaded()) return 'map.loaded() ist false';
          const merkmale = map.querySourceFeatures('fixture', { sourceLayer: kachelLayer }).length;
          if (merkmale === 0)
            return 'Quelle geladen, aber KEIN dekodiertes Merkmal — Kachel nicht geparst';
          return 'dekodiert';
        }, KACHEL_LAYER),
      {
        timeout: 20_000,
        message:
          'Kachel wird nie gelesen — Verdacht: der maplibre-Worker antwortet nicht, ' +
          'oder die Kachel-Bytes sind nicht dekodierbar',
      },
    )
    .toBe('dekodiert');

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});
