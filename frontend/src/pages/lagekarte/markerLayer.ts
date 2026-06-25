import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { KarteMarker } from './marker';
import { tzIconKey } from './markerIcons';

// Nur Felder, die eine Layer-Expression, ein Filter oder der Klick-Handler liest:
// schluessel (Klick→Inspector), farbe (marker-kreis circle-color), icon (marker-symbol icon-image +
// kreis/symbol-Diskriminierung), statusFarbe (marker-status-ring). Bewusst KEIN typ/label (write-only).
export interface MarkerProps {
  schluessel: string;
  farbe: string;
  icon?: string;
  statusFarbe?: string;
}

export type MarkerFeature = {
  type: 'Feature';
  properties: MarkerProps;
  geometry: { type: 'Point'; coordinates: [number, number] };
};

export type MarkerFeatureCollection = {
  type: 'FeatureCollection';
  features: MarkerFeature[];
};

function toFeature(mk: KarteMarker): MarkerFeature {
  const properties: MarkerProps = { schluessel: mk.schluessel, farbe: mk.farbe };
  if (mk.tz) properties.icon = tzIconKey(mk.tz);
  if (mk.statusFarbe) properties.statusFarbe = mk.statusFarbe;
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [mk.lon, mk.lat] } };
}

/** Clusterbare Marker (alle außer dem Einsatzort) als FeatureCollection. */
export function baueMarkerFc(markers: KarteMarker[]): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ !== 'einsatzort').map(toFeature),
  };
}

/** Der Einsatzort-Marker (0 oder 1 Feature) für die eigene, ungeclusterte Source. */
export function baueEinsatzortFc(markers: KarteMarker[]): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ === 'einsatzort').map(toFeature),
  };
}

export const MARKER_CLUSTER_QUELLE = 'marker-cluster';
export const MARKER_EINSATZORT_QUELLE = 'marker-einsatzort';
export const MARKER_KLICK_LAYER = [
  'marker-symbol', 'marker-kreis', 'marker-status-ring', 'marker-einsatzort-symbol',
] as const;
export const CLUSTER_LAYER = 'marker-cluster-bubble';

const MARKER_LAYER_REIHENFOLGE = [
  'marker-status-ring', 'marker-kreis', 'marker-symbol',
  'marker-cluster-bubble', 'marker-cluster-count', 'marker-einsatzort-symbol',
] as const;

/**
 * Idempotent: Sources (Cluster + ungeclusterter Einsatzort) und circle/symbol-Layer für
 * Marker + Clustering. Style-Wechsel entfernt Sources/Layer → bei der Re-Anlage erneut aufrufen.
 * Layer-Reihenfolge (Mal-Reihenfolge von unten): Status-Ring, Kreis (Lagemeldung), TZ-Symbol,
 * Cluster-Bubble, Cluster-Zahl, Einsatzort-Symbol.
 */
export function sorgeFuerMarkerLayer(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  if (!map.getSource(MARKER_CLUSTER_QUELLE)) {
    // clusterRadius:45 px — moderates Zusammenfassen erst bei echtem Gedränge (dezent, kein
    // aggressives Verschmelzen schon bei lockerer Streuung). clusterMaxZoom:14 — ab Zoom 14
    // wird nicht mehr geclustert (Einzelmarker), passend zur Detailarbeit auf Stadt-/Objektebene.
    map.addSource(MARKER_CLUSTER_QUELLE, {
      type: 'geojson', data: marker as never, cluster: true, clusterRadius: 45, clusterMaxZoom: 14,
    });
  }
  if (!map.getSource(MARKER_EINSATZORT_QUELLE)) {
    map.addSource(MARKER_EINSATZORT_QUELLE, { type: 'geojson', data: einsatzort as never });
  }
  // FMS-Status-Ring (nur Fahrzeuge mit Status) — Kreis HINTER dem Symbol, der über dessen Rand
  // hinausragt → erscheint als farbiger Ring. radius:20 (=40px Durchmesser) > die in Kartenflaeche
  // auf ≤34px normierte Symbolgröße (ZIEL_PX), analog zum früheren 3px-DOM-Border. statusFarbe
  // tragen ausschließlich Fahrzeuge (konstantes TZ) → ein fester Radius genügt.
  if (!map.getLayer('marker-status-ring')) {
    map.addLayer({
      id: 'marker-status-ring', type: 'circle', source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'statusFarbe']],
      paint: { 'circle-radius': 20, 'circle-color': ['get', 'statusFarbe'], 'circle-opacity': 0.9 },
    });
  }
  // Lagemeldung (kein TZ) — einfacher Kreis (heutige Optik: farbig, weißer Rand).
  if (!map.getLayer('marker-kreis')) {
    map.addLayer({
      id: 'marker-kreis', type: 'circle', source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['!', ['has', 'icon']]],
      paint: {
        'circle-radius': 9, 'circle-color': ['get', 'farbe'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    });
  }
  // TZ-Marker — Symbol mit lazy via styleimagemissing geladenem Icon.
  if (!map.getLayer('marker-symbol')) {
    map.addLayer({
      id: 'marker-symbol', type: 'symbol', source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'icon']],
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true },
    });
  }
  // Cluster-Bubble (dezent), Radius gestuft nach point_count.
  if (!map.getLayer('marker-cluster-bubble')) {
    map.addLayer({
      id: 'marker-cluster-bubble', type: 'circle', source: MARKER_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#1f4e79', 'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
      },
    });
  }
  if (!map.getLayer('marker-cluster-count')) {
    map.addLayer({
      id: 'marker-cluster-count', type: 'symbol', source: MARKER_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    });
  }
  // Einsatzort (eigene, ungeclusterte Source) — immer als Einzelsymbol sichtbar.
  if (!map.getLayer('marker-einsatzort-symbol')) {
    map.addLayer({
      id: 'marker-einsatzort-symbol', type: 'symbol', source: MARKER_EINSATZORT_QUELLE,
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true },
    });
  }
  pinneMarkerLayerNachOben(map);
}

/**
 * Hält die Marker-Layer über allen anderen Daten-Layern (Abschnitte/Zonen/Bilder/Fachebenen).
 * moveLayer ohne beforeId schiebt ans Ende (= oben); die Reihenfolge erhält die Mal-Reihenfolge
 * (Status-Ring unten … Einsatzort-Symbol oben).
 *
 * Muss nach JEDER dynamischen Layer-Anlage einer anderen Ebene erneut laufen: jene legen ohne
 * beforeId an und landen sonst über den Markern (verdecken sie + fangen ihre Klicks ab). Beim
 * Mount racet zudem der Marker-render-Poller mit den anderen Daten-Pollern; das Pinnen macht die
 * Reihenfolge unabhängig davon. (DOM-Marker lagen früher immer über dem Canvas.)
 */
export function pinneMarkerLayerNachOben(map: MapLibreMap) {
  for (const id of MARKER_LAYER_REIHENFOLGE) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/** Marker-Sources + Layer idempotent anlegen UND die aktuellen Daten einspielen (setData). */
export function reAnlegenMarker(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  sorgeFuerMarkerLayer(map, marker, einsatzort);
  (map.getSource(MARKER_CLUSTER_QUELLE) as GeoJSONSource | undefined)?.setData(marker as never);
  (map.getSource(MARKER_EINSATZORT_QUELLE) as GeoJSONSource | undefined)?.setData(einsatzort as never);
}
