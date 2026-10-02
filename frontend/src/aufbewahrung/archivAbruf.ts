import { ApiError } from '../api/client';

/**
 * Hat der Server den Abruf abgelehnt, gilt ein gecachter Stand nicht mehr und wird gar nicht
 * gezeigt, auch nicht als veraltet (LFH-756). TanStack behält die Daten nach einem Fehler, und
 * die Query-Keys der Aufbewahrung hängen nicht am Benutzer: ohne diese Weiche sähe ein anderer
 * Benutzer im selben Tab, bis der Konflikt aufgelöst ist, den Stand des vorigen.
 *
 * 403 fremde Organisation oder kein Admin, 404 unbekannt, 409 nicht (mehr) abgeschlossen —
 * `archivkopf` in `src/routes/aufbewahrung.rs`. Jeder andere Fehler lässt den Stand stehen,
 * die Seite meldet ihn dann als veraltet.
 */
export function standVerworfen(fehler: unknown): boolean {
  return fehler instanceof ApiError && [403, 404, 409].includes(fehler.status);
}
