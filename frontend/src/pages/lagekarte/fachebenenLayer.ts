import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FachebeneDef } from './fachebenen';
import type { FeatureCollection, FachebeneQuelle } from '../../api/fachebenen';
import { farbenHell } from '../../theme/tokens';

export const fachebeneSourceId = (key: string) => `fachebene-${key}`;

/**
 * Ein Feature ist ein Bündel, wenn MapLibre es zusammengefasst hat (`point_count`) ODER der
 * Server es als Sammelpunkt geliefert hat (`sammelpunkt`, LFH-83). Ein allein stehender
 * Sammelpunkt ist kein MapLibre-Bündel und muss trotzdem wie eines aussehen — sonst stünde
 * er als Einzelobjekt da und öffnete beim Klick ein Detail-Panel ohne Titel.
 */
const IST_BUENDEL = ['any', ['has', 'point_count'], ['has', 'sammelpunkt']];
const IST_EINZEL = ['all', ['!', ['has', 'point_count']], ['!', ['has', 'sammelpunkt']]];

/**
 * Bündel-Optik (LFH-83). Der Kreis trägt die Ebenenfarbe; Kontur und Zahl stehen AUF diesem
 * Kreis, nicht auf dem Kartengrund, und nehmen deshalb ein festes Paar aus `theme/tokens.ts`
 * statt eines Modus-Tokens: helle Fläche als Schrift, dunkler Text als Halo. Auf dem
 * gesättigten Violett trägt das in Tag- und Nachtkarte gleich; einen neuen Farbwert gibt es
 * dabei nicht. Der Radius staffelt mit der Zahl, damit ein Bündel aus Tausenden nicht so
 * aussieht wie eines aus drei.
 */
const BUENDEL_RADIUS = ['step', ['get', 'anzahl'], 12, 10, 15, 100, 18, 1000, 22, 10000, 26];

/** Idempotent: Source + (Polygon: fill/line | Punkt: circle)-Layer je Fachebene. */
export function sorgeFuerFachebeneLayer(
  map: MapLibreMap,
  def: FachebeneDef,
  daten: FeatureCollection,
) {
  const src = fachebeneSourceId(def.key);
  if (!map.getSource(src)) {
    map.addSource(
      src,
      def.buendeln
        ? {
            type: 'geojson',
            data: daten as never,
            // Bündel-Optionen greifen NUR beim Anlegen — deshalb hier und nicht per setData.
            // clusterMaxZoom 14: darüber stehen die Objekte einer Straße einzeln; der Server
            // liefert dort ohnehin Einzelobjekte (≤ 5 000 im Ausschnitt).
            cluster: true,
            clusterRadius: 50,
            clusterMaxZoom: 14,
            // Ein Server-Sammelpunkt zählt mit seiner `anzahl`, ein Einzelobjekt mit 1 —
            // so trägt ein Client-Bündel die Zahl der Objekte, nicht die seiner Punkte.
            clusterProperties: { anzahl: ['+', ['coalesce', ['get', 'anzahl'], 1]] },
          }
        : // `generateId`: die Feature-ID ist der Index im `features`-Array. Sie entscheidet beim
          // Klick zwischen überlappenden Flächen mit gleichen Properties (LFH-282,
          // `geometrieZumKlickFeature`). Die Wire-Features tragen keine eigene ID. Gebündelte
          // Ebenen (KRITIS) sind Punkte und brauchen den Stichentscheid nicht.
          { type: 'geojson', data: daten as never, generateId: true },
    );
  }
  if (def.geometrieTyp === 'polygon') {
    if (!map.getLayer(`fachebene-${def.key}-fill`)) {
      map.addLayer({
        id: `fachebene-${def.key}-fill`,
        type: 'fill',
        source: src,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': def.farbe, 'fill-opacity': 0.2 },
      });
    }
    if (!map.getLayer(`fachebene-${def.key}-line`)) {
      map.addLayer({
        id: `fachebene-${def.key}-line`,
        type: 'line',
        source: src,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': def.farbe, 'line-width': 1.5 },
      });
    }
  } else {
    if (def.buendeln && !map.getLayer(`fachebene-${def.key}-buendel`)) {
      map.addLayer({
        id: `fachebene-${def.key}-buendel`,
        type: 'circle',
        source: src,
        filter: IST_BUENDEL as never,
        paint: {
          'circle-color': def.farbe,
          'circle-radius': BUENDEL_RADIUS as never,
          'circle-stroke-color': farbenHell.flaeche,
          'circle-stroke-width': 2,
        },
      });
    }
    if (def.buendeln && !map.getLayer(`fachebene-${def.key}-buendel-zahl`)) {
      map.addLayer({
        id: `fachebene-${def.key}-buendel-zahl`,
        type: 'symbol',
        source: src,
        filter: IST_BUENDEL as never,
        layout: {
          // `anzahl` ist bei beiden Bündelarten gesetzt: als Clustersumme und als Zahl des
          // Sammelpunkts. Deutsche Tausenderpunkte („12.345"), weil die DE-Ansicht fünf-
          // stellige Bündel zeigt.
          'text-field': ['number-format', ['get', 'anzahl'], { locale: 'de-DE' }] as never,
          // Die einzige Schrift, die der Offline-Style ausliefert (`basemapStil.ts`,
          // eingebettet aus `assets/karten/fonts/`). Styles ohne `glyphs` (Blind, Raster)
          // zeichnet MapLibre 6 lokal.
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          // Die Zahl gehört auf ihren Kreis; eine Nachbarzahl darf sie nicht verdrängen,
          // sonst stünde ein Bündel ohne Zahl da.
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': farbenHell.flaeche,
          'text-halo-color': farbenHell.text,
          'text-halo-width': 1,
        },
      });
    }
    if (!map.getLayer(`fachebene-${def.key}-circle`)) {
      map.addLayer({
        id: `fachebene-${def.key}-circle`,
        type: 'circle',
        source: src,
        // Bei gebündelten Ebenen nur die Einzelobjekte — Bündel zeichnen die zwei Layer oben.
        ...(def.buendeln ? { filter: IST_EINZEL as never } : {}),
        // Größer zeichnet oben (LFH-78): Hochwasser und ODL tragen ihre Stufe im Radius, und
        // ohne Schlüssel folgte die Reihenfolge der Quelle — ein später gezeichneter kleiner
        // Nachbar deckte einen großen Alarm-Punkt zu. Ebenen ohne `radius` sind unberührt.
        layout: { 'circle-sort-key': ['coalesce', ['get', 'radius'], 0] },
        paint: {
          // Ein Feature darf Durchmesser und Farbe selbst mitbringen (LFH-77:
          // `hochwasserStil.ts` staffelt beides nach Pegelklasse und backt die im
          // aktiven Modus aufgelösten Tokenwerte ein). Ohne Eigenangabe gilt die
          // Ebenenfarbe — NINA/DWD/PEGELONLINE/KRITIS bleiben damit unverändert.
          'circle-radius': ['coalesce', ['get', 'radius'], 5],
          'circle-color': ['coalesce', ['get', 'farbe'], def.farbe],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
    }
  }
}

// Alle Layer, die eine Ebene haben KANN — `removeLayer` ist unten per `getLayer` bewacht,
// überzählige IDs kosten also nichts, und keine Ebene kann einen Layer zurücklassen.
const layerIds = (key: FachebeneQuelle) => [
  `fachebene-${key}-fill`,
  `fachebene-${key}-line`,
  `fachebene-${key}-circle`,
  `fachebene-${key}-buendel`,
  `fachebene-${key}-buendel-zahl`,
];

/** Entfernt alle Layer + Source einer Fachebene (idempotent). */
export function entferneFachebeneLayer(map: MapLibreMap, key: FachebeneQuelle) {
  for (const id of layerIds(key)) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  const src = fachebeneSourceId(key);
  if (map.getSource(src)) map.removeSource(src);
}

/** Daten einer bestehenden Fachebene-Source aktualisieren. */
export function setzeFachebeneDaten(
  map: MapLibreMap,
  key: FachebeneQuelle,
  daten: FeatureCollection,
) {
  const s = map.getSource(fachebeneSourceId(key)) as GeoJSONSource | undefined;
  if (s) s.setData(daten as never);
}

/**
 * Die anklickbaren Layer einer Fachebene (Polygon → Fläche, Punkt → Kreis; gebündelte Ebene
 * zusätzlich der Bündel-Kreis). Die Zahl ist kein eigenes Ziel — sie liegt auf dem Kreis.
 */
export function fachebeneClickLayerIds(def: FachebeneDef): string[] {
  if (def.geometrieTyp === 'polygon') return [`fachebene-${def.key}-fill`];
  const kreis = `fachebene-${def.key}-circle`;
  return def.buendeln ? [kreis, `fachebene-${def.key}-buendel`] : [kreis];
}

/** Was ein Klick auf ein Fachebenen-Feature auslöst (LFH-83). */
export type FachebeneKlickZiel =
  /** MapLibre-Bündel: auf dessen Aufklapp-Zoom (`getClusterExpansionZoom`) hineinzoomen. */
  | { art: 'buendel'; clusterId: number }
  /** Server-Sammelpunkt (oder Bündel ohne ID): um `zoomSchritt` Stufen hineinzoomen. */
  | { art: 'sammelpunkt'; zoomSchritt: number }
  /** Einzelobjekt: Detailansicht wie bisher. */
  | { art: 'einzel' };

/**
 * Entscheidet rein aus den Properties des angeklickten Features, was der Klick tut — ohne
 * Karte, damit die Unterscheidung ohne WebGL prüfbar ist. Die Ausführung
 * (`getClusterExpansionZoom` ist in MapLibre 6 asynchron, `easeTo`) liegt beim Aufrufer.
 */
export function entscheideFachebeneKlick(props: Record<string, unknown>): FachebeneKlickZiel {
  if (props.cluster === true && typeof props.cluster_id === 'number') {
    return { art: 'buendel', clusterId: props.cluster_id };
  }
  // Ein Bündel ohne lesbare ID zoomt wenigstens — ein Detail-Panel für ein Bündel wäre leer.
  if (props.sammelpunkt === true || props.cluster === true) {
    return { art: 'sammelpunkt', zoomSchritt: 2 };
  }
  return { art: 'einzel' };
}

const KATEGORIE_LABEL: Record<string, string> = {
  krankenhaus: 'Krankenhaus',
  pflege: 'Pflegeeinrichtung',
  schule: 'Schule / Kita',
  wasser: 'Wasserversorgung',
  strom: 'Umspannwerk',
  feuerwehr: 'Feuerwehr',
  polizei: 'Polizei',
  kritis: 'KRITIS-Objekt',
  warnung: 'Amtliche Warnung',
  pegel: 'Pegel',
  odl: 'ODL-Messsonde (BfS)',
  webcam: 'Webcam',
  baustelle: 'Baustelle',
  sperrung: 'Sperrung',
};

/** Lesbares Label für eine normalisierte Kategorie (Fallback: Rohwert). */
export function kategorieLabel(kategorie: string): string {
  return KATEGORIE_LABEL[kategorie] ?? kategorie;
}
