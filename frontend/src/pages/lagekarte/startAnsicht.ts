import type { KarteMarker } from './marker';

/**
 * Wohin die Lagekarte beim Öffnen schaut (Nacharbeit Neuentwurf, 22.09.2026).
 *
 * Bis hierher startete die Karte IMMER auf „Mitte Deutschland, Zoom 5" (Konstruktor in
 * `Kartenflaeche.tsx`) — auch dann, wenn der Einsatz verortet war. Das war keine Regression
 * des Umbaus, sondern schon vorher so (`82e9440f` hat dieselbe Konstruktorzeile); in der
 * Sichtprüfung fiel es auf, weil die Karte im Neuentwurf die Seite führt.
 *
 * Reihenfolge, jede Stufe nur mit echten Daten (keine erfundenen Koordinaten):
 * 1. Zentrum der aktiven Ansicht, wenn sie eins trägt (`zentrum_lat`/`zentrum_lon`).
 * 2. Der Einsatzort-Marker — er ist der fachliche Bezugspunkt des Einsatzes.
 * 3. Genau ein verortetes Objekt → auf dieses.
 * 4. Mehrere verortete Objekte → Rahmen um alle.
 * 5. Nichts verortet → `null`: die Karte bleibt auf der neutralen Übersicht.
 *
 * Der Zoom kommt aus der Ansicht (`zoom`, gesät aus `karten_zoom_start`), sonst
 * {@link PUNKT_ZOOM}. Rein, damit die Entscheidung ohne WebGL prüfbar ist.
 */
export type StartAnsicht =
  | { art: 'punkt'; lng: number; lat: number; zoom: number }
  | { art: 'rahmen'; west: number; sued: number; ost: number; nord: number };

/** Zoom auf einen einzelnen Bezugspunkt: Ortsteil-Maßstab, Straßen und Gebäude lesbar. */
export const PUNKT_ZOOM = 14;

export interface AnsichtZentrum {
  zentrum_lat?: number | null;
  zentrum_lon?: number | null;
  zoom?: number | null;
}

function gueltig(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function startAnsicht(
  marker: readonly Pick<KarteMarker, 'typ' | 'lat' | 'lon'>[],
  ansicht?: AnsichtZentrum | null,
): StartAnsicht | null {
  const zoom = ansicht?.zoom != null && Number.isFinite(ansicht.zoom) ? ansicht.zoom : PUNKT_ZOOM;
  const lat = ansicht?.zentrum_lat;
  const lon = ansicht?.zentrum_lon;
  if (lat != null && lon != null && gueltig(lat, lon)) return { art: 'punkt', lng: lon, lat, zoom };

  const punkte = marker.filter((m) => gueltig(m.lat, m.lon));
  const ort = punkte.find((m) => m.typ === 'einsatzort');
  if (ort) return { art: 'punkt', lng: ort.lon, lat: ort.lat, zoom };
  if (punkte.length === 0) return null;
  if (punkte.length === 1) return { art: 'punkt', lng: punkte[0].lon, lat: punkte[0].lat, zoom };

  let west = Infinity;
  let sued = Infinity;
  let ost = -Infinity;
  let nord = -Infinity;
  for (const m of punkte) {
    west = Math.min(west, m.lon);
    ost = Math.max(ost, m.lon);
    sued = Math.min(sued, m.lat);
    nord = Math.max(nord, m.lat);
  }
  // Alle Objekte auf einem Punkt: ein Rahmen ohne Ausdehnung zöge fitBounds auf maxZoom.
  if (west === ost && sued === nord) return { art: 'punkt', lng: west, lat: sued, zoom };
  return { art: 'rahmen', west, sued, ost, nord };
}
