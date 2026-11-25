import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from '../../api/fachebenen';
import { farbenHell } from '../../theme/tokens';

/**
 * Fremdebenen auf der Karte (LLH-2099, Entwurf „Oberfläche“, „Zeichnen“): die Geometrie, die der
 * Server geprüft und normiert hat (nur `name` und `description` als Properties), in der Farbe der
 * Ebene. Gebaut wie der Mischgeometrie-Weg der Fachebenen (`fachebenenLayer.ts`,
 * `gemischteGeometrie`), aber mit EINER Farbe je Ebene statt einer je Feature und mit eigenem
 * Schlüssel je Ebene (`wendeKartenDatenAn(map, \`fremdebene-<id>\`, …)`).
 */

/** Was die Karte von einer gezeigten Fremdebene braucht. */
export interface AktiveFremdebene {
  id: number;
  /** Ebenenname — Detailkarte und Legende. */
  name: string;
  daten: FeatureCollection;
  /** Ebenenfarbe des aktiven Modus (`fremdebeneFarbe`). */
  farbe: string;
}

export const fremdebeneSourceId = (id: number) => `fremdebene-${id}`;

/** Alle Layer einer Ebene, in Zeichenfolge (unten zuerst). */
export const fremdebeneLayerIds = (id: number) => [
  `fremdebene-${id}-flaeche`,
  `fremdebene-${id}-linie`,
  `fremdebene-${id}-punkt`,
  `fremdebene-${id}-text`,
];

/** Die Ebene einer Layer-ID (`fremdebene-<id>-<teil>`), sonst `null`. */
export function fremdebeneIdVon(layerId: string): number | null {
  const m = /^fremdebene-(\d+)-(flaeche|linie|punkt|text)$/.exec(layerId);
  return m ? Number(m[1]) : null;
}

/** Geometrietyp, auch in der Multi-Form (wie `isGeometrieTyp` in `fachebenenLayer.ts`). */
const isGeometrieTyp = (typ: 'Polygon' | 'LineString' | 'Point') => [
  'any',
  ['==', ['geometry-type'], typ],
  ['==', ['geometry-type'], `Multi${typ}`],
];

/** Ab dieser Zoomstufe steht der Name an den Objekten; darunter überdeckte die Schrift die Lage. */
export const FREMDEBENE_TEXT_AB_ZOOM = 14;

/** Rand am Punkt wie bei den Fachebenen-Punkten (2 px Weiß), damit er auf jedem Grund steht. */
const RAND_BREITE = 2;

/**
 * Die Ebene liegt über den Hintergründen und unter den eigenen Zeichnungen (Entwurf): eingefügt
 * vor dem ersten eigenen Lage-Layer (`abschnitte-fill`, darunter liegen nur Basemap und Bilder).
 * Gibt es ihn noch nicht (erster Aufbau), legt `reAnlegenAlles` die eigenen Layer danach darüber.
 */
const ERSTER_EIGENER_LAYER = 'abschnitte-fill';
const vorEigenenLagen = (map: MapLibreMap) =>
  map.getLayer(ERSTER_EIGENER_LAYER) ? ERSTER_EIGENER_LAYER : undefined;

/**
 * Anker eines Bild-Hintergrunds: unter der untersten Fremdebene, ohne Fremdebene vor den eigenen
 * Lage-Layern. Ein Bild, das bei sichtbarer Fremdebene hinzukommt, läge sonst zwischen ihr und
 * `abschnitte-fill`, also über ihr, und ein deckendes Luftbild verdeckte sie ganz.
 */
export function bildAnker(map: MapLibreMap): string {
  return (
    map.getLayersOrder().find((id) => /^fremdebene-\d+-flaeche$/.test(id)) ?? ERSTER_EIGENER_LAYER
  );
}

/**
 * Idempotent: Quelle und vier Layer einer Fremdebene anlegen, Daten einspielen, Farbe nachziehen
 * (ein Moduswechsel oder „Farbe …“ legt keinen Layer neu an).
 */
export function sorgeFuerFremdebeneLayer(
  map: MapLibreMap,
  ebeneId: number,
  daten: FeatureCollection,
  farbe: string,
): void {
  const src = fremdebeneSourceId(ebeneId);
  const quelle = map.getSource(src) as GeoJSONSource | undefined;
  if (quelle) quelle.setData(daten as never);
  // `generateId`: die Wire-Features tragen keine ID; der Index entscheidet beim Klick zwischen
  // überlappenden Flächen mit gleichen Properties (wie bei den Fachebenen, LFH-282).
  else map.addSource(src, { type: 'geojson', data: daten as never, generateId: true });

  const vor = vorEigenenLagen(map);
  const [flaeche, linie, punkt, text] = fremdebeneLayerIds(ebeneId);
  const anlegen = (spec: Parameters<MapLibreMap['addLayer']>[0]) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec, vor);
  };
  anlegen({
    id: flaeche,
    type: 'fill',
    source: src,
    filter: isGeometrieTyp('Polygon') as never,
    paint: { 'fill-color': farbe, 'fill-opacity': 0.25 },
  });
  // Linien und der Umriss der Flächen in einem Layer: beide tragen dieselbe Farbe.
  anlegen({
    id: linie,
    type: 'line',
    source: src,
    filter: ['any', isGeometrieTyp('LineString'), isGeometrieTyp('Polygon')] as never,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': farbe, 'line-width': 2 },
  });
  anlegen({
    id: punkt,
    type: 'circle',
    source: src,
    filter: isGeometrieTyp('Point') as never,
    paint: {
      'circle-radius': 6,
      'circle-color': farbe,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': RAND_BREITE,
    },
  });
  anlegen({
    id: text,
    type: 'symbol',
    source: src,
    minzoom: FREMDEBENE_TEXT_AB_ZOOM,
    filter: ['has', 'name'],
    layout: {
      'text-field': ['get', 'name'],
      // Die einzige Schrift, die der Offline-Style ausliefert (wie die Bündelzahl der Fachebenen).
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-optional': true,
    },
    // Festes Paar wie die Bündelzahl (`fachebenenLayer.ts`): die Schrift steht auf der Karte, nicht
    // auf einer Fläche des Modus.
    paint: {
      'text-color': farbenHell.text,
      'text-halo-color': farbenHell.flaeche,
      'text-halo-width': 1.5,
    },
  });
  const ziele: [string, 'fill-color' | 'line-color' | 'circle-color'][] = [
    [flaeche, 'fill-color'],
    [linie, 'line-color'],
    [punkt, 'circle-color'],
  ];
  for (const [id, eigenschaft] of ziele) {
    if (map.getLayer(id)) map.setPaintProperty(id, eigenschaft, farbe);
  }
}

/** Entfernt alle Layer und die Quelle einer Fremdebene (idempotent). */
export function entferneFremdebeneLayer(map: MapLibreMap, ebeneId: number): void {
  for (const id of fremdebeneLayerIds(ebeneId)) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  const src = fremdebeneSourceId(ebeneId);
  if (map.getSource(src)) map.removeSource(src);
}

/** Die anklickbaren Layer einer Fremdebene; die Beschriftung ist kein Ziel. */
export const fremdebeneClickLayerIds = (ebeneId: number) => fremdebeneLayerIds(ebeneId).slice(0, 3);

/** Ein leerer Wert zählt wie ein fehlender: die Karte reicht `null` nicht verlässlich durch. */
const gefuellt = (p: Record<string, unknown> | null | undefined) =>
  Object.entries(p ?? {}).filter(([, v]) => v != null);

/**
 * Steht das gewählte Objekt noch auf der Karte? Nur dann bleibt seine Detailkarte offen: eine
 * ausgeblendete oder entfernte Ebene oder ein Objekt, das ein Abgleich gestrichen oder geändert hat,
 * zeigte sonst alte Angaben. Die Wire-Features tragen keine ID (die Karte zählt sie selbst), also
 * gilt ein Objekt mit denselben Properties als dasselbe.
 */
export function fremdObjektSichtbar(
  aktive: readonly AktiveFremdebene[],
  ebeneId: number,
  properties: Record<string, unknown>,
): boolean {
  const ebene = aktive.find((e) => e.id === ebeneId);
  if (!ebene) return false;
  const gesucht = gefuellt(properties);
  return ebene.daten.features.some((f) => {
    const p = gefuellt(f.properties as Record<string, unknown> | null | undefined);
    return (
      p.length === gesucht.length &&
      gesucht.every(([k, v]) => p.some(([k2, v2]) => k2 === k && v2 === v))
    );
  });
}
