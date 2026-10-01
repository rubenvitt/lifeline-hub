import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { GefundenerOrt } from '../../anzeige/ortssuche';
import { EIGENPOSITION_LAYER } from './eigenpositionLayer';

/**
 * Kartenebene der Suchnadel (LFH-638, design.md D3): ein Ring mit Mittelpunkt an dem Ort, den die
 * Ortssuche angesprungen hat. GeoJSON-Ebene wie die Eigenposition (`eigenpositionLayer.ts`), kein
 * DOM-Marker: der finge Zeigerereignisse ab. Die Ebenen haben KEINE Rolle in `ordneKlickebene`
 * (`klickziel.ts`) — ein Tipp auf die Nadel trifft, was darunter liegt. Die Beschriftung steht im
 * Fuß-Band (`KartenFuss`), nicht auf der Karte.
 *
 * Ring statt Scheibe: die gefüllte Scheibe ist die Eigenposition, beide tragen die Bedienrolle.
 * Den Verlust bei `setStyle` fängt `Kartenflaeche` über den Render-Poller ab.
 */

export const SUCHNADEL_QUELLE = 'suchnadel';
export const SUCHNADEL_LAYER = ['suchnadel-kante', 'suchnadel-ring', 'suchnadel-punkt'] as const;

type SuchnadelFc = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[];
};

/** Ohne Ort eine leere Sammlung — die Ebene bleibt angelegt, zeigt aber nichts. */
export function suchnadelFc(ort: GefundenerOrt | null): SuchnadelFc {
  if (!ort) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [ort.lon, ort.lat] },
      },
    ],
  };
}

/**
 * Quelle und Layer idempotent anlegen, Daten einspielen, nach oben ziehen. `farbe` ist die
 * Bedienrolle. Kontur wie am Personen-Marker: der Ring liegt auf einer schwarzen Kante, die ihn
 * beidseitig säumt, der Punkt trägt einen weißen Rand — beides hält gegen jeden Grund.
 */
export function sorgeFuerSuchnadelLayer(map: MapLibreMap, daten: SuchnadelFc, farbe: string): void {
  const quelle = map.getSource(SUCHNADEL_QUELLE) as GeoJSONSource | undefined;
  // Nie gesetzt → nichts anlegen; eine Karte ohne Suche trägt keine leeren Layer.
  if (!quelle && daten.features.length === 0) return;
  if (quelle) quelle.setData(daten as never);
  else map.addSource(SUCHNADEL_QUELLE, { type: 'geojson', data: daten as never });

  const layer: Record<(typeof SUCHNADEL_LAYER)[number], object> = {
    // Ring 14 mit Strich 3, die Kante darunter mit Strich 5: je 1 px Schwarz innen und außen.
    'suchnadel-kante': {
      type: 'circle',
      paint: {
        'circle-radius': 14,
        'circle-opacity': 0,
        'circle-stroke-color': '#000',
        'circle-stroke-width': 5,
      },
    },
    'suchnadel-ring': {
      type: 'circle',
      paint: {
        'circle-radius': 14,
        'circle-opacity': 0,
        'circle-stroke-color': farbe,
        'circle-stroke-width': 3,
      },
    },
    'suchnadel-punkt': {
      type: 'circle',
      paint: {
        'circle-color': farbe,
        'circle-radius': 3,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1,
      },
    },
  };
  // Über den Markern, aber unter der Eigenposition: der Gerätestandort bleibt oben, auch wenn die
  // Nadel nach ihm gesetzt wird.
  const unter = map.getLayer(EIGENPOSITION_LAYER[0]) ? EIGENPOSITION_LAYER[0] : undefined;
  for (const id of SUCHNADEL_LAYER) {
    if (!map.getLayer(id)) {
      map.addLayer({ id, source: SUCHNADEL_QUELLE, ...layer[id] } as never);
    } else if (id === 'suchnadel-ring') {
      // Moduswechsel Tag/Nacht: die Bedienfarbe ändert sich, der Layer bleibt.
      map.setPaintProperty(id, 'circle-stroke-color', farbe);
    } else if (id === 'suchnadel-punkt') {
      map.setPaintProperty(id, 'circle-color', farbe);
    }
    map.moveLayer(id, unter);
  }
}
