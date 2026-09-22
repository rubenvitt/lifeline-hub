import { apiGet, apiSend } from './client';
import { einsatzKeys } from './queryKeys';
import type { PegelAnzeige } from './types';

/**
 * Maßgebliche Pegel eines Einsatzes (LFH-606).
 *
 * Alle drei Routen antworten mit der VOLLSTÄNDIGEN Liste in Reihenfolge, je Eintrag mit der
 * jüngsten Messung. Die Mutationen setzen die Antwort deshalb per `setQueryData` auf
 * {@link einsatzKeys.pegel}, statt eine Invalidierung mit zweitem Abruf auszulösen.
 */

/** Eine Station, wie sie gewählt wird (Snapshot von Name und Gewässer zum Festlegen). */
export interface PegelWahl {
  station_uuid: string;
  name: string;
  gewaesser?: string | null;
}

/** Höchstzahl maßgeblicher Pegel je Einsatz — dieselbe Grenze wie `PEGEL_MAX` im Backend. */
export const PEGEL_MAX = 5;

/**
 * Nachfrage-Takt: kein Live-Ereignis (die Messwerte ändern sich im 15-min-Raster der
 * Quelle), also alle 5 min — derselbe Wert wie die Cache-Frist im Backend.
 */
export const PEGEL_ABRUF_MS = 5 * 60_000;

export function listePegel(einsatzId: number): Promise<PegelAnzeige[]> {
  return apiGet<PegelAnzeige[]>(`/api/einsaetze/${einsatzId}/pegel`);
}

/** Ersetzt die Liste vollständig; die Reihenfolge ist die des Arrays (erster = Leitpegel). */
export function setzePegel(einsatzId: number, stationen: PegelWahl[]): Promise<PegelAnzeige[]> {
  return apiSend<PegelAnzeige[]>(`/api/einsaetze/${einsatzId}/pegel`, 'PUT', { stationen });
}

/** Hängt eine Station hinten an; eine schon festgelegte bleibt unverändert (200, idempotent). */
export function fuegePegelHinzu(einsatzId: number, station: PegelWahl): Promise<PegelAnzeige[]> {
  return apiSend<PegelAnzeige[]>(`/api/einsaetze/${einsatzId}/pegel`, 'POST', station);
}

/**
 * Die EINE Abfrage-Konfiguration für alle Leser (Dashboard, Überblick, Einstellungen,
 * Lagekarte): gleicher Key, gleicher Takt — sonst zöge der Leser mit dem kürzesten Intervall
 * die anderen mit, ohne dass es irgendwo stünde.
 */
export function pegelAbfrage(einsatzId: number) {
  return {
    queryKey: einsatzKeys.pegel(einsatzId),
    queryFn: () => listePegel(einsatzId),
    refetchInterval: PEGEL_ABRUF_MS,
  };
}
