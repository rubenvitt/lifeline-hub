import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { GeoJsonPolygon, GeoJsonGeometry } from './geo';
import type { ZoneStil } from './zonenStil';
import { wendeKartenDatenAn } from './kartenDaten';
import { sorgeFuerFachebeneLayer, setzeFachebeneDaten } from './fachebenenLayer';
import type { FachebeneDef } from './fachebenen';
import type { FeatureCollection } from '../../api/fachebenen';
import { synchronisiereBildLayer, type BildOverlay } from './bildLayer';
import { reAnlegenMarker, type MarkerFeatureCollection } from './markerLayer';
import { farbenDunkel, type Farbrollen } from '../../theme/tokens';

export type { BildOverlay };

export interface AktiveFachebene {
  def: FachebeneDef;
  daten: FeatureCollection;
}

/**
 * Zentrale (Re-)Anlage der entitätslosen Karten-Layer (Abschnittsflächen + Zonen).
 *
 * Warum hier und nicht in `Kartenflaeche.tsx`: nur `import type` von maplibre-gl →
 * kein WebGL-Laufzeitimport → in jsdom testbar. So lässt sich die *Sequenz* nach
 * einem Basemap-/Theme-Wechsel (Style-Wechsel → zuverlässige Re-Anlage) ohne Karte
 * prüfen — genau der Pfad, der vorher fehlte und alle Zeichnungen verschwinden ließ.
 */

export interface ZoneFeature {
  id: number;
  geometrie: GeoJsonGeometry;
  label: string | null;
  stil: ZoneStil;
  /** Gefahrenzone: Umriss gestrichelt (Neuentwurf S5). Nur Darstellung, keine Geometrie. */
  gestrichelt?: boolean;
  /** Farben der Beschriftungsplakette aus den Rollen des aktiven Modus. Ohne Angabe: Nacht. */
  plakette?: ZonenPlakette;
}

/**
 * Beschriftung einer Zone im Entwurfsstil (Neuentwurf S5): dunkle Plakette mit Rahmen
 * `linieStark`, Text in `text`. Die Werte sind AUFGELÖSTE Rollen — MapLibre-`paint` kennt
 * weder `var(--lfh-*)` noch antd-Token, deshalb reicht `useLagekarteDaten` sie durch, wie
 * es den Token für die Zonenfarben schon tut.
 */
export interface ZonenPlakette {
  text: string;
  grund: string;
  rahmen: string;
}

/** Plakette aus einem Rollensatz — rein, damit die Rollenwahl ohne Karte prüfbar ist. */
export function zonenPlakette(rollen: Pick<Farbrollen, 'text' | 'paneel' | 'linieStark'>) {
  return { text: rollen.text, grund: rollen.paneel, rahmen: rollen.linieStark };
}

/** Präfix der Plakettenbilder; `styleimagemissing` in `Kartenflaeche.tsx` erkennt es daran. */
export const PLAKETTE_PRAEFIX = 'plakette|';

/** Bild-Id einer Plakette: die Farben stehen IN der Id, damit der Handler sie nach einem
 *  `setStyle` (der alle Bilder wegwischt) ohne weiteren Zustand neu zeichnen kann. */
export function plakettenBildId(p: Pick<ZonenPlakette, 'grund' | 'rahmen'>): string {
  return `${PLAKETTE_PRAEFIX}${p.grund}|${p.rahmen}`;
}

/** `#rrggbb` → [r, g, b]; alles andere → null (dann gibt es keine Plakette, nur Text). */
function hexZuRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Kantenlänge des Plakettenbilds; 1 px Rahmen, der Rest dehnbar (9-Slice). */
const PLAKETTE_KANTE = 8;

/**
 * Das Plakettenbild als Pixeldaten für `map.addImage` — ein 9-Slice aus 1 px Rahmen und
 * dehnbarem Innenraum, das `icon-text-fit` um den Text legt. Rein und exportiert: die
 * Karte selbst läuft in jsdom nicht, die Pixel schon. `null` für eine fremde oder
 * unlesbare Id — der Aufrufer legt dann kein Bild an, und die Beschriftung steht ohne
 * Plakette da, statt dass ein Fehler aus dem MapLibre-Callback fliegt.
 */
export function plakettenBild(id: string): {
  width: number;
  height: number;
  data: Uint8Array;
  stretchX: [number, number][];
  stretchY: [number, number][];
  content: [number, number, number, number];
} | null {
  if (!id.startsWith(PLAKETTE_PRAEFIX)) return null;
  const [grundHex, rahmenHex] = id.slice(PLAKETTE_PRAEFIX.length).split('|');
  const grund = hexZuRgb(grundHex ?? '');
  const rahmen = hexZuRgb(rahmenHex ?? '');
  if (!grund || !rahmen) return null;
  const k = PLAKETTE_KANTE;
  const data = new Uint8Array(k * k * 4);
  for (let y = 0; y < k; y++) {
    for (let x = 0; x < k; x++) {
      const rand = x === 0 || y === 0 || x === k - 1 || y === k - 1;
      const [r, g, b] = rand ? rahmen : grund;
      const i = (y * k + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      // Der Grund deckt nicht ganz (Entwurf: `rgba(12,14,17,.92)`), der Rahmen schon.
      data[i + 3] = rand ? 255 : 235;
    }
  }
  return {
    width: k,
    height: k,
    data,
    stretchX: [[1, k - 1]],
    stretchY: [[1, k - 1]],
    content: [1, 1, k - 1, k - 1],
  };
}

export type FlaechenFeatureCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: number;
    properties: { id: number; label: string };
    geometry: GeoJsonPolygon;
  }[];
};

export type ZonenFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: number;
    properties: {
      id: number;
      label: string;
      fillColor: string;
      fillOpacity: number;
      lineColor: string;
      lineWidth: number;
      gestrichelt: boolean;
      textFarbe: string;
      plakette: string;
    };
    geometry: GeoJsonGeometry;
  }>;
};

export function baueFlaechenFc(
  flaechen: { id: number; label: string; polygon: GeoJsonPolygon }[] | undefined,
): FlaechenFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (flaechen ?? []).map((f) => ({
      type: 'Feature',
      id: f.id,
      properties: { id: f.id, label: f.label },
      geometry: f.polygon,
    })),
  };
}

export function baueZonenFc(zonen: ZoneFeature[] | undefined): ZonenFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (zonen ?? []).map((z) => {
      const plakette = z.plakette ?? zonenPlakette(farbenDunkel);
      return {
        type: 'Feature' as const,
        id: z.id,
        properties: {
          id: z.id,
          label: z.label ?? '',
          fillColor: z.stil.fillColor,
          fillOpacity: z.stil.fillOpacity,
          lineColor: z.stil.lineColor,
          lineWidth: z.stil.lineWidth,
          gestrichelt: z.gestrichelt ?? false,
          textFarbe: plakette.text,
          plakette: plakettenBildId(plakette),
        },
        geometry: z.geometrie,
      };
    }),
  };
}

/** Idempotent: legt Source + fill/line-Layer für Abschnittsflächen an (Style-Wechsel entfernt sie). */
export function sorgeFuerAbschnittLayer(map: MapLibreMap, daten: FlaechenFeatureCollection) {
  if (!map.getSource('abschnitte')) {
    map.addSource('abschnitte', { type: 'geojson', data: daten as never });
  }
  if (!map.getLayer('abschnitte-fill')) {
    map.addLayer({
      id: 'abschnitte-fill',
      type: 'fill',
      source: 'abschnitte',
      paint: { 'fill-color': '#722ed1', 'fill-opacity': 0.15 },
    });
  }
  if (!map.getLayer('abschnitte-line')) {
    map.addLayer({
      id: 'abschnitte-line',
      type: 'line',
      source: 'abschnitte',
      paint: { 'line-color': '#722ed1', 'line-width': 2 },
    });
  }
}

/** Idempotent: Source + fill/line/label-Layer für Zonen (datengetriebenes Paint; Style-Wechsel entfernt sie). */
export function sorgeFuerZonenLayer(map: MapLibreMap, daten: ZonenFeatureCollection) {
  if (!map.getSource('zonen')) {
    map.addSource('zonen', { type: 'geojson', data: daten as never });
  }
  if (!map.getLayer('zonen-fill')) {
    map.addLayer({
      id: 'zonen-fill',
      type: 'fill',
      source: 'zonen',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] },
    });
  }
  // Durchgezogen und gestrichelt als ZWEI gefilterte Layer statt eines datengetriebenen
  // `line-dasharray`: Arrays lassen sich nicht aus Feature-Properties lesen, und ein Layer,
  // den MapLibre bei der Validierung ablehnt, fehlt STILL — die Zonen stünden ohne Umriss da.
  // Der Klick-Handler hängt an `zonen-line`: gestrichelt sind nur Gefahrengebiete, und die
  // sind Flächen, die über `zonen-fill` angeklickt werden.
  if (!map.getLayer('zonen-line')) {
    map.addLayer({
      id: 'zonen-line',
      type: 'line',
      source: 'zonen',
      filter: ['!=', ['get', 'gestrichelt'], true],
      paint: { 'line-color': ['get', 'lineColor'], 'line-width': ['get', 'lineWidth'] },
    });
  }
  if (!map.getLayer('zonen-line-gestrichelt')) {
    map.addLayer({
      id: 'zonen-line-gestrichelt',
      type: 'line',
      source: 'zonen',
      filter: ['==', ['get', 'gestrichelt'], true],
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': ['get', 'lineWidth'],
        'line-dasharray': [3, 2],
      },
    });
  }
  // Beschriftung im Entwurfsstil: Plakette (9-Slice-Bild, `icon-text-fit`) statt Halo,
  // Versalien per `text-transform` — der Text selbst bleibt, wie `zonenBeschriftung` ihn
  // baut. Die Schrift bleibt die Vorgabe des Styles: eine Mono-Familie, die der
  // Glyphen-Server nicht führt, liesse die Beschriftung ganz verschwinden.
  if (!map.getLayer('zonen-label')) {
    map.addLayer({
      id: 'zonen-label',
      type: 'symbol',
      source: 'zonen',
      filter: ['!=', ['get', 'label'], ''],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'symbol-placement': 'point',
        'icon-image': ['get', 'plakette'],
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [3, 6, 3, 6],
      },
      paint: { 'text-color': ['get', 'textFarbe'] },
    });
  }
}

/** Beide Layer-Gruppen idempotent anlegen UND die aktuellen Daten einspielen (setData). */
export function reAnlegenAlles(
  map: MapLibreMap,
  flaechen: FlaechenFeatureCollection,
  zonen: ZonenFeatureCollection,
  fachebenen: AktiveFachebene[] = [],
  bilder: BildOverlay[] = [],
  marker?: MarkerFeatureCollection,
  einsatzort?: MarkerFeatureCollection,
) {
  // Bilder zuerst (vor abschnitte-fill, das gleich angelegt wird → beforeId noch nicht da:
  // daher OHNE beforeId anlegen und danach abschnitte/zonen drüber legen).
  synchronisiereBildLayer(map, bilder);
  sorgeFuerAbschnittLayer(map, flaechen);
  (map.getSource('abschnitte') as GeoJSONSource | undefined)?.setData(flaechen as never);
  sorgeFuerZonenLayer(map, zonen);
  (map.getSource('zonen') as GeoJSONSource | undefined)?.setData(zonen as never);
  for (const fe of fachebenen) {
    sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
    setzeFachebeneDaten(map, fe.def.key, fe.daten);
  }
  // Marker zuletzt (= oberste Layer; sorgeFuerMarkerLayer pinnt sie zusätzlich nach oben).
  if (marker && einsatzort) reAnlegenMarker(map, marker, einsatzort);
}

/**
 * Nach einem Style-Wechsel (`setStyle`: Basemap/Theme) sind alle Custom-Sources/Layer
 * weg. Die Re-Anlage NICHT an `styledata` + `isStyleLoaded()` hängen (unzuverlässig:
 * beim Online-Wechsel wird der Style gesetzt, bevor die Tiles geladen sind — das
 * `styledata`-Event mit `isStyleLoaded()===true` bleibt dann aus, und die Zeichnungen
 * kämen erst beim nächsten Daten-Update zurück). Stattdessen über den bewährten
 * render-Frame-Poller `wendeKartenDatenAn` — derselbe Pfad wie beim Zeichnen.
 *
 * `getFlaechen`/`getZonen` werden ERST im vertagten Lauf gelesen → die zuletzt
 * bekannten Daten landen auf der Karte.
 */
export function planeReAnlegenNachStyle(
  map: Pick<MapLibreMap, 'isStyleLoaded' | 'on' | 'off'> & MapLibreMap,
  getFlaechen: () => FlaechenFeatureCollection,
  getZonen: () => ZonenFeatureCollection,
  getFachebenen: () => AktiveFachebene[] = () => [],
  getBilder: () => BildOverlay[] = () => [],
  getMarker?: () => MarkerFeatureCollection,
  getEinsatzort?: () => MarkerFeatureCollection,
) {
  wendeKartenDatenAn(map, () =>
    reAnlegenAlles(
      map,
      getFlaechen(),
      getZonen(),
      getFachebenen(),
      getBilder(),
      getMarker?.(),
      getEinsatzort?.(),
    ),
  );
}
