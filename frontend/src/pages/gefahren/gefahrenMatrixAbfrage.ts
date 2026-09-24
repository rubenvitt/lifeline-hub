import { queryOptions } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeMatrix } from '../../api/gefahren';

/**
 * Abrufoptionen der Gefahrenmatrix eines Gefahrengebiets — EINE Quelle für die Gefahrenseite
 * und die Gefahrengebiet-Vorschau der Sprungpalette (LFH-664, Entscheidung 5a).
 *
 * Zwei Beobachter auf einem Fach müssen Schlüssel UND Abruffunktion teilen: gleicher Schlüssel
 * mit anderer Funktion schriebe zwei Formen in ein Fach (siehe `command-palette/datensatzAbfrage.ts`).
 * Das Fach ist live über das Ereignis `gefahr` (`EINSATZ_STREAM_EVENTS`).
 *
 * Kein `enabled` hier: ob abgefragt wird, entscheidet der Aufrufer — die Seite, solange kein
 * Gebiet gewählt ist (`gebietId === null`), die Vorschau gar nicht, sie hat immer eine id.
 * Keine eigene Frische: beide Aufrufer fahren die globale Vorgabe wie bisher die Seite.
 */
export function gefahrenMatrixAbfrage(einsatzId: number, gebietId: number | null) {
  return queryOptions({
    queryKey: einsatzKeys.gefahrenmatrix(einsatzId, gebietId),
    queryFn: () => ladeMatrix(einsatzId, gebietId as number),
  });
}
