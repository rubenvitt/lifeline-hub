import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { GeoJsonPolygon, GeoJsonGeometry } from './geo';
import type { ZoneStil } from './zonenStil';
import { wendeKartenDatenAn } from './kartenDaten';
import { sorgeFuerFachebeneLayer, setzeFachebeneDaten } from './fachebenenLayer';
import type { FachebeneDef } from './fachebenen';
import type { FeatureCollection } from '../../api/fachebenen';
import { synchronisiereBildLayer, type BildOverlay } from './bildLayer';
import { reAnlegenMarker, type MarkerFeatureCollection } from './markerLayer';
import { farbenDunkel } from '../../theme/tokens';
import { plakettenBildId, plakettenSchrift, zonenPlakette, type Plakette } from './plakette';

export type { BildOverlay };
// Die Plakette ist ein eigenes Modul (Marker brauchen sie auch, `markerLayer` → `kartenLayer` wäre
// ein Importkreis); die Bestandsimporte laufen weiter über diesen Re-Export.
export { PLAKETTE_PRAEFIX, plakettenBild, plakettenBildId, zonenPlakette } from './plakette';

export interface AktiveFachebene {
  def: FachebeneDef;
  daten: FeatureCollection;
}

/**
 * Zentrale (Re-)Anlage der entitätslosen Karten-Layer (Abschnittsflächen + Zonen). Hier und nicht
 * in `Kartenflaeche.tsx`, weil nur `import type` von maplibre-gl nötig ist — so ist die Sequenz
 * nach einem Style-Wechsel in jsdom prüfbar.
 */

export interface ZoneFeature {
  id: number;
  geometrie: GeoJsonGeometry;
  label: string | null;
  stil: ZoneStil;
  /** Gefahrenzone: Umriss gestrichelt. Nur Darstellung. */
  gestrichelt?: boolean;
  /** Farben der Beschriftungsplakette aus den Rollen des aktiven Modus. Ohne Angabe: Nacht. */
  plakette?: ZonenPlakette;
}

/** Farben der Beschriftungsplakette — für Zonen und Marker (`plakette.ts`). */
export type ZonenPlakette = Plakette;

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
  // Durchgezogen und gestrichelt als zwei gefilterte Layer statt eines datengetriebenen
  // `line-dasharray`: Arrays lassen sich nicht aus Properties lesen, und ein abgelehnter Layer
  // fehlt still. Der Klick-Handler hängt an `zonen-line` — gestrichelt sind nur Gefahrengebiete,
  // und die werden über `zonen-fill` angeklickt.
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
  // Plakette (9-Slice-Bild, `icon-text-fit`) statt Halo, Versalien per `text-transform`. Die
  // Schrift wählt `plakettenSchrift` je Glyphen-Server: Mono nur offline, wo der eigene Server sie
  // führt (eine fremde Familie beantwortet er mit 404).
  if (!map.getLayer('zonen-label')) {
    const schrift = plakettenSchrift(map.getStyle());
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
        ...(schrift ? { 'text-font': schrift } : {}),
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
  // Bilder zuerst, ohne beforeId (abschnitte-fill gibt es noch nicht); Abschnitte und Zonen legen
  // sich danach darüber.
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
 * Nach `setStyle` sind alle Custom-Sources/Layer weg. Die Re-Anlage hängt nicht an `styledata` +
 * `isStyleLoaded()` — beim Online-Wechsel bleibt dieses Event aus, bis die Tiles geladen sind —,
 * sondern am render-Frame-Poller `wendeKartenDatenAn`. `getFlaechen`/`getZonen` werden erst im
 * vertagten Lauf gelesen.
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
