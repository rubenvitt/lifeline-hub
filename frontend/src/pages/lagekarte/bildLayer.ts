import type { Map as MapLibreMap, ImageSource } from 'maplibre-gl';
import type { Ecken } from '../../api/kartenbilder';

export interface BildOverlay {
  id: number;
  blobUrl: string;
  ecken: Ecken;
  opazitaet: number; // 0..100
  sichtbar: boolean;
}

export const bildSourceId = (id: number) => `bild-${id}`;
export const bildLayerId = (id: number) => `bild-${id}-raster`;

const opacityWert = (o: BildOverlay) => (o.sichtbar ? o.opazitaet / 100 : 0);

/** Idempotent: image source + raster layer. `beforeId` platziert den Layer unter
 *  den Vektor-Overlays (Abschnitte/Zonen), damit Marker/Zonen darüber liegen. */
export function sorgeFuerBildLayer(map: MapLibreMap, ov: BildOverlay, beforeId?: string) {
  const sid = bildSourceId(ov.id);
  if (!map.getSource(sid)) {
    map.addSource(sid, {
      type: 'image',
      url: ov.blobUrl,
      coordinates: ov.ecken as unknown as [[number, number], [number, number], [number, number], [number, number]],
    } as never);
  }
  const lid = bildLayerId(ov.id);
  if (!map.getLayer(lid)) {
    const vorAnker = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
    map.addLayer({
      id: lid,
      type: 'raster',
      source: sid,
      paint: { 'raster-opacity': opacityWert(ov), 'raster-fade-duration': 0 },
    }, vorAnker);
  } else {
    map.setPaintProperty(lid, 'raster-opacity', opacityWert(ov));
  }
}

export function setzeBildGeometrie(map: MapLibreMap, id: number, ecken: Ecken) {
  const s = map.getSource(bildSourceId(id)) as ImageSource | undefined;
  s?.setCoordinates(ecken as unknown as [[number, number], [number, number], [number, number], [number, number]]);
}

export function setzeBildOpazitaet(map: MapLibreMap, id: number, opazitaet: number, sichtbar: boolean) {
  const lid = bildLayerId(id);
  if (map.getLayer(lid)) {
    map.setPaintProperty(lid, 'raster-opacity', sichtbar ? opazitaet / 100 : 0);
  }
}

export function entferneBildLayer(map: MapLibreMap, id: number) {
  const lid = bildLayerId(id);
  if (map.getLayer(lid)) map.removeLayer(lid);
  const sid = bildSourceId(id);
  if (map.getSource(sid)) map.removeSource(sid);
}

/** WeakMap zur Verfolgung verwalteter IDs je Map-Instanz (für synchronisiereBildLayer). */
const verwalteteIds = new WeakMap<object, Set<number>>();

/** Soll-Abgleich: legt fehlende an, aktualisiert Geometrie/Opazität bestehender,
 *  entfernt nicht mehr gelistete. */
export function synchronisiereBildLayer(
  map: MapLibreMap,
  overlays: BildOverlay[],
  beforeId?: string,
): Set<number> {
  const soll = new Set(overlays.map((o) => o.id));
  const vorherige = verwalteteIds.get(map as object) ?? new Set<number>();

  // entfernen was nicht mehr im Soll ist
  for (const id of vorherige) {
    if (!soll.has(id)) {
      entferneBildLayer(map, id);
    }
  }

  // anlegen / aktualisieren (in Reihenfolge: Aufrufer sortiert overlays aufsteigend)
  for (const ov of overlays) {
    sorgeFuerBildLayer(map, ov, beforeId);
    setzeBildGeometrie(map, ov.id, ov.ecken);
    setzeBildOpazitaet(map, ov.id, ov.opazitaet, ov.sichtbar);
  }

  verwalteteIds.set(map as object, soll);
  return soll;
}
