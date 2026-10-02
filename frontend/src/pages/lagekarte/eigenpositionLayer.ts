import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Eigenposition } from './useEigenposition';

/**
 * Kartenebene der Eigenposition: Genauigkeitskreis als Fläche in Metern plus Punkt. Eine
 * GeoJSON-Quelle statt eines DOM-Markers, weil der Kreis mit dem Zoom mitwachsen muss. Den Verlust
 * bei `setStyle` fängt `Kartenflaeche` über den Render-Poller ab.
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
 * Kreis um (lat, lon) mit Radius in Metern als geschlossener Ring — auf der Kugel gerechnet, damit
 * er nicht mit cos(lat) gestaucht wird.
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

/**
 * Rahmen des Genauigkeitskreises als `[[west, süd], [ost, nord]]` für `fitBounds` (LFH-766, D1):
 * der erste Anflug zeigt den ganzen Kreis statt eines festen Zooms. Aus demselben Ring wie die
 * Fläche, damit Rahmen und Zeichnung nicht auseinanderlaufen.
 */
export function eigenpositionRahmen(position: Eigenposition): [[number, number], [number, number]] {
  if (!(position.genauigkeit > 0)) {
    return [
      [position.lon, position.lat],
      [position.lon, position.lat],
    ];
  }
  const ring = genauigkeitsKreis(position.lat, position.lon, position.genauigkeit);
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
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
 * Präfix aller terra-draw-Ebenen der Lagekarte (`prefixId` je Instanz, Regel in
 * `pages/lagekarte/AGENTS.md`, Zeichnen und Messen).
 */
export const ZEICHNUNG_PRAEFIX = 'td-';

/**
 * Eigenposition über alle Lagedaten ziehen, aber unter die laufende Zeichnung (LFH-766,
 * design.md D3): sonst deckte der Punkt beim Zeichnen am eigenen Standort die Stützpunkte. Läuft
 * bei jeder Meldung und nach jedem Pinnen der Marker (`pinneMarkerLayerNachOben`) — sonst lägen
 * Marker bis zur nächsten Standortmeldung über dem Punkt. Ohne angelegte Ebenen tut sie nichts.
 */
export function ordneEigenpositionEin(map: MapLibreMap): void {
  if (!EIGENPOSITION_LAYER.some((id) => map.getLayer(id))) return;
  // Vor die erste Zeichenebene der Style-Reihenfolge; ohne Zeichnung ganz nach oben.
  const vor = map.getStyle()?.layers?.find((l) => l.id.startsWith(ZEICHNUNG_PRAEFIX))?.id;
  for (const id of EIGENPOSITION_LAYER) {
    if (map.getLayer(id)) map.moveLayer(id, vor);
  }
}

/**
 * Quelle und Layer idempotent anlegen, Daten einspielen, einordnen (`ordneEigenpositionEin`).
 * `farbe` ist die Bedienrolle: die Eigenposition ist eine aktive Beziehung des Geräts. Rand und
 * Kante sind Kontur (Weiß plus Schwarz halten gegen jeden Grund, wie am Personen-Marker).
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
  }
  ordneEigenpositionEin(map);
}
