import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Eigenposition } from './useEigenposition';

/**
 * Kartenebene der Eigenposition (LFH-712): Genauigkeitskreis als Fläche in Metern plus Punkt.
 * Eine eigene GeoJSON-Quelle statt eines DOM-Markers: der Kreis muss mit dem Zoom mitwachsen,
 * und ein DOM-Element müsste dafür bei jedem Zoom nachgerechnet werden. Den Verlust bei
 * `setStyle` fängt `Kartenflaeche` über denselben Render-Poller ab wie die übrigen Ebenen.
 */

export const EIGENPOSITION_QUELLE = 'eigenposition';
export const EIGENPOSITION_LAYER = [
  'eigenposition-kreis',
  'eigenposition-kreisrand',
  'eigenposition-kante',
  'eigenposition-punkt',
] as const;

const ERDRADIUS_M = 6_371_008.8;

/**
 * Kreis um (lat, lon) mit Radius in Metern als geschlossener Ring aus `stuetzen` Punkten —
 * auf der Kugel gerechnet (Zielpunkt aus Peilung und Distanz), damit er in Nord-Süd- und
 * Ost-West-Richtung gleich weit reicht und nicht mit cos(lat) gestaucht wird.
 */
export function genauigkeitsKreis(
  lat: number,
  lon: number,
  radiusM: number,
  stuetzen = 64,
): [number, number][] {
  const d = radiusM / ERDRADIUS_M;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i < stuetzen; i++) {
    const peilung = (2 * Math.PI * i) / stuetzen;
    const phi2 = Math.asin(
      Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(peilung),
    );
    const lambda2 =
      lambda1 +
      Math.atan2(
        Math.sin(peilung) * Math.sin(d) * Math.cos(phi1),
        Math.cos(d) - Math.sin(phi1) * Math.sin(phi2),
      );
    ring.push([(lambda2 * 180) / Math.PI, (phi2 * 180) / Math.PI]);
  }
  ring.push(ring[0]);
  return ring;
}

type EigenpositionFc = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, never>;
    geometry:
      | { type: 'Polygon'; coordinates: [number, number][][] }
      | { type: 'Point'; coordinates: [number, number] };
  }[];
};

/** Ohne Position eine leere Sammlung — die Ebene bleibt angelegt, zeigt aber nichts. */
export function eigenpositionFc(position: Eigenposition | null): EigenpositionFc {
  if (!position) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [genauigkeitsKreis(position.lat, position.lon, position.genauigkeit)],
        },
      },
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
      },
    ],
  };
}

/**
 * Quelle und Layer idempotent anlegen, Daten einspielen, nach oben ziehen. `farbe` ist die
 * Bedienrolle des aktiven Modus: die Eigenposition ist eine aktive Beziehung des Geräts,
 * kein Zustand eines Objekts. Rand und Kante sind Kontur, keine Rolle — dieselbe Wahl wie am
 * Personen-Marker (`markerLayer.ts`, LFH-650): Weiß plus Schwarz halten gegen jeden Grund.
 */
export function sorgeFuerEigenpositionLayer(
  map: MapLibreMap,
  daten: EigenpositionFc,
  farbe: string,
): void {
  const quelle = map.getSource(EIGENPOSITION_QUELLE) as GeoJSONSource | undefined;
  // Nie eingeschaltet → nichts anlegen; eine Karte ohne Eigenposition trägt keine leeren Layer.
  if (!quelle && daten.features.length === 0) return;
  if (quelle) quelle.setData(daten as never);
  else map.addSource(EIGENPOSITION_QUELLE, { type: 'geojson', data: daten as never });

  const flaeche = ['==', ['geometry-type'], 'Polygon'];
  const punkt = ['==', ['geometry-type'], 'Point'];
  const layer: Record<(typeof EIGENPOSITION_LAYER)[number], object> = {
    'eigenposition-kreis': {
      type: 'fill',
      filter: flaeche,
      paint: { 'fill-color': farbe, 'fill-opacity': 0.12 },
    },
    'eigenposition-kreisrand': {
      type: 'line',
      filter: flaeche,
      paint: { 'line-color': farbe, 'line-width': 1 },
    },
    // Kreis 7 + weißer Rand 2 = 9, schwarze Kante bis 11.
    'eigenposition-kante': {
      type: 'circle',
      filter: punkt,
      paint: { 'circle-color': '#000', 'circle-radius': 11 },
    },
    'eigenposition-punkt': {
      type: 'circle',
      filter: punkt,
      paint: {
        'circle-color': farbe,
        'circle-radius': 7,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    },
  };
  for (const id of EIGENPOSITION_LAYER) {
    if (!map.getLayer(id)) {
      map.addLayer({ id, source: EIGENPOSITION_QUELLE, ...layer[id] } as never);
    } else if (id === 'eigenposition-punkt') {
      // Moduswechsel Tag/Nacht: die Bedienfarbe ändert sich, der Layer bleibt.
      map.setPaintProperty(id, 'circle-color', farbe);
    } else if (id === 'eigenposition-kreis') {
      map.setPaintProperty(id, 'fill-color', farbe);
    } else if (id === 'eigenposition-kreisrand') {
      map.setPaintProperty(id, 'line-color', farbe);
    }
    map.moveLayer(id);
  }
}
