import type { Page, Route } from '@playwright/test';

// Fixture-Basemap der Lagekarte ohne Netz und ohne Seed (LFH-356, LFH-558): `page.route`
// beantwortet `/api/karte/config`, Style-JSON und Kacheln. `page.route` greift auch für die
// Anfragen des maplibre-Workers. VEKTOR, weil maplibre Raster-Kacheln auf dem Hauptthread lädt —
// nur eine Vector-Source geht durch den Worker.
//
// „GELESEN" HEISST DEKODIERT (`querySourceFeatures`), nicht `loaded()`: eine gescheiterte Kachel
// gilt als `errored` und zählt wie geladen, der Fehler kommt als `error`-Event statt als
// `pageerror`. Eine leere oder kaputte Kachel-Antwort macht einen Test also NICHT rot — nur ein
// dekodiertes Merkmal tut es.

/**
 * Eine echte, minimale Mapbox-Vector-Tile: ein Layer `layer` mit EINER LineString-Geometrie.
 * Nicht leer (eine leere Tile ist gültig und belegte kein Parsen) und ohne Bibliothek: sind die
 * Bytes falsch, findet `querySourceFeatures` nichts und der Test wird rot.
 * Aufbau (vector_tile.proto), hier für `strassen` (33 Bytes):
 *   1A 1F                        Tile.layers (Feld 3, Länge 31 = 23 + Namenslänge)
 *     78 02                      Layer.version = 2            (Feld 15)
 *     0A 08 'strassen'           Layer.name                   (Feld 1, Länge = Namenslänge)
 *     12 0E                      Layer.features (Feld 2, Länge 14)
 *       08 01                    Feature.id = 1               (Feld 1)
 *       18 02                    Feature.type = LINESTRING    (Feld 3)
 *       22 08 …                  Feature.geometry, gepackt    (Feld 4)
 *            09                  MoveTo, 1×
 *            00 00               dx=0, dy=0       (Zickzack)
 *            0A                  LineTo, 1×
 *            C8 01 C8 01         dx=+100, dy=+100 (Zickzack 200)
 *     28 80 20                   Layer.extent = 4096          (Feld 5)
 * Ohne `tags` braucht die Kachel weder `keys` noch `values`. Die beiden Längen sind einbytige
 * Varints — deshalb höchstens 104 ASCII-Zeichen Name (Layerlänge < 128).
 */
export function vektorKachel(layer: string): Buffer {
  const name = Buffer.from(layer, 'ascii');
  if (name.length === 0 || 23 + name.length > 0x7f || name.toString('ascii') !== layer)
    throw new Error(`Layername nicht als einbytige Länge kodierbar: ${layer}`);
  return Buffer.from([
    0x1a,
    23 + name.length,
    // Layer
    0x78,
    0x02,
    0x0a,
    name.length,
    ...name,
    // Feature
    0x12,
    0x0e,
    0x08,
    0x01,
    0x18,
    0x02,
    0x22,
    0x08,
    0x09,
    0x00,
    0x00,
    0x0a,
    0xc8,
    0x01,
    0xc8,
    0x01,
    // extent
    0x28,
    0x80,
    0x20,
  ]);
}

/** Ausschnitt von `KarteConfigAntwort` — nachgebildet, der Spec-Ordner bindet nicht gegen die
 *  Anwendung. */
export interface FixtureKartenConfig {
  online_styles?: { name: string; typ: 'vektor'; url: string }[];
  offline_regionen?: {
    karte_id: number;
    name: string;
    tiles_url: string;
    format: 'vektor';
    maxzoom: number;
  }[];
}

/** `/api/karte/config` beantworten. Ohne Offline-Region ist die Offline-Grundlage gesperrt. */
export async function kartenConfigBeantworten(page: Page, config: FixtureKartenConfig) {
  const regionen = config.offline_regionen ?? [];
  await page.route('**/api/karte/config', (route: Route) =>
    route.fulfill({
      json: {
        karten_bau_verfuegbar: false,
        offline_regionen: regionen,
        offline_verfuegbar: regionen.length > 0,
        // Ein Online-View macht `defaultModus` zu 'online'. Die Karte entsteht trotzdem mit dem
        // Blindstil und bekommt den ersten Kachel-Style erst mit der Kartenansicht (`setStyle`).
        online_styles: config.online_styles ?? [],
      },
    }),
  );
}

/**
 * Style-JSON eines Online-Vektor-Views unter `stilPfad`: eine Vector-Source `quelle` mit der
 * Kachel-Vorlage und ein Linien-Layer AUF ihr (ohne Layer auf der Source fragt MapLibre keine
 * Kachel an).
 */
export async function vektorStilBeantworten(
  page: Page,
  stilPfad: string,
  quelle: { id: string; kachelVorlage: string; layer: string },
) {
  await page.route(`**${stilPfad}`, (route: Route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          [quelle.id]: { type: 'vector', tiles: [quelle.kachelVorlage], minzoom: 0, maxzoom: 14 },
        },
        layers: [
          {
            id: `${quelle.id}-grund`,
            type: 'background',
            paint: { 'background-color': '#e8e8e8' },
          },
          {
            id: `${quelle.id}-linien`,
            type: 'line',
            source: quelle.id,
            'source-layer': quelle.layer,
          },
        ],
      },
    }),
  );
}

/**
 * Alle Kacheln unter `praefix` mit `vektorKachel(layer)` beantworten. Liefert die Liste der
 * angefragten URLs (sie wächst weiter, während die Karte lädt).
 */
export async function kachelnBeantworten(
  page: Page,
  praefix: string,
  layer: string,
): Promise<string[]> {
  const anfragen: string[] = [];
  const body = vektorKachel(layer);
  await page.route(`**${praefix}**`, (route: Route) => {
    anfragen.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body });
  });
  return anfragen;
}
