import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Rahmen } from './abschnittFokus';
import { ANFLUG_ZOOM, BEDIENUNG } from './kamera';

/** Rand um den Rahmen beim Fokus, in Pixeln (wie beim Anflug der Eigenposition). */
const FOKUS_RAND = 48;

/** Kamera, die der Fokus auf einen Abschnitt beim Aufheben wiederherstellt (LLH-1057, D4). */
export interface KameraStand {
  center: [number, number];
  zoom: number;
  bearing: number;
}

/**
 * Fokus auf einen Abschnitt (LLH-1057): den Rahmen einpassen, die Drehung behalten. Eine Bedienung
 * — die Einsatzkraft hat „Abschnitt fokussieren“ gewählt oder den Link geöffnet. Gibt die Kamera
 * davor zurück, damit „Fokus aufheben“ dorthin zurückfährt.
 */
export function fokussiereRahmen(map: MapLibreMap, rahmen: Rahmen): KameraStand {
  const mitte = map.getCenter();
  const vorher: KameraStand = {
    center: [mitte.lng, mitte.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
  };
  map.fitBounds(
    rahmen,
    { padding: FOKUS_RAND, maxZoom: ANFLUG_ZOOM, bearing: vorher.bearing },
    BEDIENUNG,
  );
  return vorher;
}

/** „Fokus aufheben“ und Esc: zurück auf die Kamera vor dem Fokus (LLH-1057). */
export function stelleKameraHer(map: MapLibreMap, stand: KameraStand): void {
  map.easeTo({ center: stand.center, zoom: stand.zoom, bearing: stand.bearing }, BEDIENUNG);
}
