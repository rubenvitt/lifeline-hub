import type { Map as MapLibreMap, MapLibreEvent } from 'maplibre-gl';
import { eigenpositionRahmen } from './eigenpositionLayer';
import type { Eigenposition } from './useEigenposition';

/**
 * Kamerabewegungen der Lagekarte: wer hat bewegt? (LFH-766,
 * `openspec/changes/archive/2026-10-02-lfh-766-eigenposition-anflug-genauigkeit/design.md` D1/D2)
 *
 * MapLibre setzt `originalEvent` nur bei Gesten, Rad und Tastatur. Die Knöpfe der Überlagerung,
 * „Bild einpassen“ und der Bündel-Tipp rufen die Kamera programmatisch — für MapLibre sähen sie aus
 * wie die Startansicht oder ein `resize`. Deshalb trägt JEDER Kamera-Aufruf in `Kartenflaeche`
 * eine der beiden Markierungen als `eventData` (Wächter: `kamera.guard.test.ts`).
 */

/** Anflugzoom der Kartenziele (Auswahl, Ortssuche) und Obergrenze des Eigenpositions-Anflugs. */
export const ANFLUG_ZOOM = 15;

/** `eventData` einer Kamerabewegung, die die Einsatzkraft ausgelöst hat. */
export const BEDIENUNG = { bedienung: true } as const;

/** `eventData` einer Kamerabewegung, die die Karte von sich aus macht (Startansicht, Anflug). */
export const AUTOMATISCH = { bedienung: false } as const;

/**
 * Zoom eines Anflugs (LLH-1751, D5 in
 * `openspec/changes/archive/2026-11-16-bo5wokwi-lagekarte-knoepfe-leiste-zoom/design.md`):
 * nur heran, nie heraus. Steht die Karte näher als {@link ANFLUG_ZOOM}, behält sie ihren Zoom —
 * wer einen Ausschnitt eingestellt hat, verliert ihn nicht durch einen Anflug. `laufendesZiel`:
 * Zielzoom eines Anflugs, der gerade noch fliegt, sonst `null`.
 */
export function anflugZoom(aktuell: number, laufendesZiel: number | null = null): number {
  // Mitten in einem Anflug ist `aktuell` ein Punkt der Flugkurve, die zwischen entfernten Zielen
  // herauszoomt; maßgeblich ist dann das Ziel des laufenden Anflugs (Review LLH-1751).
  return Math.max(laufendesZiel ?? aktuell, ANFLUG_ZOOM);
}

/**
 * Versatz in Pixeln, um den ein Punkt der Karte zurück ins Bild muss (LLH-1751, Review): ein
 * Marker-Tipp bewegt die Kamera nicht, aber die Auswahl öffnet die Leiste und verkleinert die
 * Karte. Liegt der gewählte Marker danach außerhalb von `fläche` minus `rand` (je Seite; rechts
 * mit dem Knopfblock), liefert die Funktion den kleinsten Versatz `[dx, dy]` für `panBy`, der ihn
 * an den Rand holt; sonst `null`.
 * Rein und exportiert.
 */
export function nachfuehrVersatz(
  punkt: { x: number; y: number },
  flaeche: { breite: number; hoehe: number },
  rand: { oben: number; rechts: number; unten: number; links: number },
): [number, number] | null {
  const klemme = (w: number, min: number, max: number) => Math.min(Math.max(w, min), max);
  const dx = punkt.x - klemme(punkt.x, rand.links, flaeche.breite - rand.rechts);
  const dy = punkt.y - klemme(punkt.y, rand.oben, flaeche.hoehe - rand.unten);
  return dx === 0 && dy === 0 ? null : [dx, dy];
}

/** Rand um den Genauigkeitskreis beim Anflug, in Pixeln. */
const ANFLUG_RAND = 48;

/** Geste, Rad, Tastatur (`originalEvent`) oder markierter Bedienweg (`BEDIENUNG`); `resize` und
 *  `AUTOMATISCH` zählen nicht. */
export function istBedienung(e: { originalEvent?: unknown; bedienung?: unknown }): boolean {
  return e.originalEvent != null || e.bedienung === true;
}

/** Meldet jeden bedienten Bewegungsanfang; gibt das Aufräumen zurück. */
export function hoereAufBedienung(map: MapLibreMap, onBedienung: () => void): () => void {
  const hoerer = (e: MapLibreEvent & { bedienung?: unknown }) => {
    if (istBedienung(e)) onBedienung();
  };
  map.on('movestart', hoerer);
  return () => {
    map.off('movestart', hoerer);
  };
}

/**
 * Erster Anflug der Eigenposition: der ganze Genauigkeitskreis ins Bild, bei genauer Ortung nicht
 * näher als die übrigen Kartenziele.
 */
export function fliegeEigenpositionAn(map: MapLibreMap, position: Eigenposition): void {
  map.fitBounds(
    eigenpositionRahmen(position),
    // Ohne `bearing` richtete `fitBounds` die Karte nach Norden aus — eine Bewegung, die niemand
    // ausgelöst hat; der alte `flyTo` behielt die Drehung.
    { padding: ANFLUG_RAND, maxZoom: ANFLUG_ZOOM, bearing: map.getBearing() },
    AUTOMATISCH,
  );
}
