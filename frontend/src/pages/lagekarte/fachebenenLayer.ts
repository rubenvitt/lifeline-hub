import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FachebeneDef } from './fachebenen';
import type { FeatureCollection, FachebeneQuelle } from '../../api/fachebenen';
import { farbenHell } from '../../theme/tokens';

export const fachebeneSourceId = (key: string) => `fachebene-${key}`;

/**
 * Ein Feature ist ein Bündel, wenn MapLibre es zusammengefasst hat (`point_count`) oder der Server
 * es als Sammelpunkt liefert. Ein allein stehender Sammelpunkt muss wie ein Bündel aussehen, sonst
 * öffnete er beim Klick ein Detail-Panel ohne Titel.
 */
const IST_BUENDEL = ['any', ['has', 'point_count'], ['has', 'sammelpunkt']];
const IST_EINZEL = ['all', ['!', ['has', 'point_count']], ['!', ['has', 'sammelpunkt']]];

/**
 * Bündel-Optik: der Kreis trägt die Ebenenfarbe; Kontur und Zahl stehen auf diesem Kreis und nehmen
 * deshalb ein festes Paar aus `theme/tokens.ts` statt eines Modus-Tokens. Der Radius staffelt mit
 * der Zahl.
 */
const BUENDEL_RADIUS = ['step', ['get', 'anzahl'], 12, 10, 15, 100, 18, 1000, 22, 10000, 26];

/** Ein Feature darf seine Farbe selbst mitbringen (`hochwasserStil.ts`); sonst die Ebenenfarbe. */
const punktFarbe = (farbe: string) => ['coalesce', ['get', 'farbe'], farbe];

/** Ein Feature darf seinen Radius selbst mitbringen — bei Hochwasser, Luftqualität und ODL die Stufe. */
const PUNKT_RADIUS = ['coalesce', ['get', 'radius'], 5];

/**
 * Doppelkante (LFH-600) wie bei den Personen-Markern (`KANTE_PAINT` in `markerLayer.ts`): 2 px Weiß
 * als Rand am Zeichen, darunter 2 px Schwarz als eigene Ebene, also Zeichenradius + 4. Weiß und
 * Schwarz nebeneinander halten gegen jeden Kartengrund max(K(weiß, g), K(schwarz, g)) ≥ √21 ≈ 4,58
 * : 1 (WCAG 1.4.11), auch auf Online-Styles, deren Farben niemand vorher kennt. Bewusst `'#000'`
 * statt eines Tokens: die Kante ist Kontur, keine Status- oder Ebenenaussage.
 */
const RAND_BREITE = 2;
const KANTE_BREITE = 2;
const KANTE_FARBE = '#000';
const mitKante = (radius: unknown) => ['+', radius, RAND_BREITE + KANTE_BREITE];

/**
 * Idempotent: Source + (Polygon: fill/line | Punkt: circle)-Layer je Fachebene. `farbe` ist die
 * Ebenenfarbe des aktiven Modus (`fachebeneFarbe`, LFH-593); an schon bestehenden Layern wird sie
 * nachgezogen, denn ein Moduswechsel ohne neuen Kartenstil legt keinen Layer neu an.
 */
export function sorgeFuerFachebeneLayer(
  map: MapLibreMap,
  def: FachebeneDef,
  daten: FeatureCollection,
  farbe: string,
  treffer: number,
) {
  const src = fachebeneSourceId(def.key);
  if (!map.getSource(src)) {
    map.addSource(
      src,
      def.buendeln
        ? {
            type: 'geojson',
            data: daten as never,
            // Bündel-Optionen greifen nur beim Anlegen — deshalb hier und nicht per setData. Ab
            // clusterMaxZoom 14 stehen die Objekte einzeln; der Server liefert dort ohnehin
            // Einzelobjekte.
            cluster: true,
            clusterRadius: 50,
            clusterMaxZoom: 14,
            // Ein Server-Sammelpunkt zählt mit seiner `anzahl`, ein Einzelobjekt mit 1 — so trägt
            // ein Client-Bündel die Zahl der Objekte.
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
        paint: { 'fill-color': farbe, 'fill-opacity': 0.2 },
      });
    }
    if (!map.getLayer(`fachebene-${def.key}-line`)) {
      map.addLayer({
        id: `fachebene-${def.key}-line`,
        type: 'line',
        source: src,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': farbe, 'line-width': 1.5 },
      });
    }
  } else {
    // Unsichtbare Trefferzone (LFH-600), zuunterst: Durchmesser = `controlHeight` der Dichtestufe wie
    // bei den Markern (LFH-711), unabhängig vom gezeichneten Radius, der die Stufe trägt. Ohne Filter
    // — Einzelpunkt, Client-Bündel und Server-Sammelpunkt tragen sie gleich. MapLibre prüft beim
    // Klick die Geometrie, nicht die Deckkraft; `klickziel.ts` ordnet sie als `fachebeneTreffer`.
    if (!map.getLayer(`fachebene-${def.key}-treffer`)) {
      map.addLayer({
        id: `fachebene-${def.key}-treffer`,
        type: 'circle',
        source: src,
        paint: { 'circle-radius': treffer / 2, 'circle-opacity': 0, 'circle-stroke-width': 0 },
      });
    }
    if (def.buendeln && !map.getLayer(`fachebene-${def.key}-buendel-kante`)) {
      map.addLayer({
        id: `fachebene-${def.key}-buendel-kante`,
        type: 'circle',
        source: src,
        filter: IST_BUENDEL as never,
        paint: { 'circle-radius': mitKante(BUENDEL_RADIUS) as never, 'circle-color': KANTE_FARBE },
      });
    }
    if (def.buendeln && !map.getLayer(`fachebene-${def.key}-buendel`)) {
      map.addLayer({
        id: `fachebene-${def.key}-buendel`,
        type: 'circle',
        source: src,
        filter: IST_BUENDEL as never,
        paint: {
          'circle-color': farbe,
          'circle-radius': BUENDEL_RADIUS as never,
          'circle-stroke-color': farbenHell.flaeche,
          'circle-stroke-width': RAND_BREITE,
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
          // `anzahl` ist bei beiden Bündelarten gesetzt. Deutsche Tausenderpunkte, weil die
          // DE-Ansicht fünfstellige Bündel zeigt.
          'text-field': ['number-format', ['get', 'anzahl'], { locale: 'de-DE' }] as never,
          // Die einzige Schrift, die der Offline-Style ausliefert (`assets/karten/fonts/`). Styles
          // ohne `glyphs` zeichnet MapLibre 6 lokal.
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          // Eine Nachbarzahl darf die Zahl nicht verdrängen, sonst stünde ein Bündel ohne Zahl da.
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
    // Bei gebündelten Ebenen nur die Einzelobjekte — Bündel zeichnen die Layer oben.
    const einzelFilter = def.buendeln ? { filter: IST_EINZEL as never } : {};
    // Größer zeichnet oben: Hochwasser und ODL tragen ihre Stufe im Radius, ohne Schlüssel
    // deckte ein später gezeichneter kleiner Nachbar einen großen Alarm-Punkt zu. Die Kante
    // sortiert gleich, sonst läge die schwarze Kante eines großen Punkts unter der eines kleinen.
    const sortierung = { 'circle-sort-key': ['coalesce', ['get', 'radius'], 0] };
    if (!map.getLayer(`fachebene-${def.key}-kante`)) {
      map.addLayer({
        id: `fachebene-${def.key}-kante`,
        type: 'circle',
        source: src,
        ...einzelFilter,
        layout: sortierung as never,
        paint: { 'circle-radius': mitKante(PUNKT_RADIUS) as never, 'circle-color': KANTE_FARBE },
      });
    }
    if (!map.getLayer(`fachebene-${def.key}-circle`)) {
      map.addLayer({
        id: `fachebene-${def.key}-circle`,
        type: 'circle',
        source: src,
        ...einzelFilter,
        layout: sortierung as never,
        paint: {
          // Ein Feature darf Durchmesser und Farbe selbst mitbringen (`hochwasserStil.ts` backt die
          // aufgelösten Tokenwerte ein). Ohne Eigenangabe gilt die Ebenenfarbe.
          'circle-radius': PUNKT_RADIUS as never,
          'circle-color': punktFarbe(farbe) as never,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': RAND_BREITE,
        },
      });
    }
    // Ein Dichtewechsel legt keinen Layer neu an — der Radius der Zone wird nachgezogen.
    map.setPaintProperty(`fachebene-${def.key}-treffer`, 'circle-radius', treffer / 2);
  }
  zieheEbenenfarbeNach(map, def.key, farbe);
}

/**
 * Setzt die Ebenenfarbe an jedem vorhandenen Layer der Ebene. Frisch angelegte tragen sie schon;
 * MapLibre verwirft einen unveränderten Wert selbst, der Aufruf ist also billig.
 */
function zieheEbenenfarbeNach(map: MapLibreMap, key: FachebeneQuelle, farbe: string) {
  const ziele: [string, 'fill-color' | 'line-color' | 'circle-color', unknown][] = [
    [`fachebene-${key}-fill`, 'fill-color', farbe],
    [`fachebene-${key}-line`, 'line-color', farbe],
    [`fachebene-${key}-buendel`, 'circle-color', farbe],
    [`fachebene-${key}-circle`, 'circle-color', punktFarbe(farbe)],
  ];
  for (const [id, eigenschaft, wert] of ziele) {
    if (map.getLayer(id)) map.setPaintProperty(id, eigenschaft, wert as never);
  }
}

// Alle Layer, die eine Ebene haben kann — `removeLayer` ist per `getLayer` bewacht, überzählige IDs
// kosten nichts.
const layerIds = (key: FachebeneQuelle) => [
  `fachebene-${key}-fill`,
  `fachebene-${key}-line`,
  `fachebene-${key}-circle`,
  `fachebene-${key}-kante`,
  `fachebene-${key}-treffer`,
  `fachebene-${key}-buendel`,
  `fachebene-${key}-buendel-kante`,
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
 * Die anklickbaren Layer einer Fachebene (Polygon → Fläche, Punkt → Kreis und Trefferzone, gebündelt
 * zusätzlich der Bündel-Kreis). Die Zahl liegt auf dem Kreis und ist kein eigenes Ziel, die Kante
 * ist Kontur.
 */
export function fachebeneClickLayerIds(def: FachebeneDef): string[] {
  if (def.geometrieTyp === 'polygon') return [`fachebene-${def.key}-fill`];
  const kreis = `fachebene-${def.key}-circle`;
  const treffer = `fachebene-${def.key}-treffer`;
  return def.buendeln ? [kreis, `fachebene-${def.key}-buendel`, treffer] : [kreis, treffer];
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
 * Entscheidet allein aus den Properties, was der Klick tut — ohne Karte prüfbar. Die Ausführung
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
  luftmessstation: 'Luftmessstation',
};

/** Lesbares Label für eine normalisierte Kategorie (Fallback: Rohwert). */
export function kategorieLabel(kategorie: string): string {
  return KATEGORIE_LABEL[kategorie] ?? kategorie;
}
