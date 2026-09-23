import { apiGet } from './client';
import { PEGEL_ABRUF_MS } from './pegel';
import { einsatzKeys } from './queryKeys';
import type { WetterAnzeige } from './types';

/**
 * Wetter am Einsatzort (LFH-633): gültige DWD-Warnungen der Warnzelle und die 24-h-Vorhersage,
 * beide über Bright Sky. Ein Ausfall der Quelle ist KEIN HTTP-Fehler — jeder Teil trägt seinen
 * eigenen `zustand` (`ok` · `kein_ort` · `ausfall`), damit ein Teil den anderen nicht mitreißt.
 */
export function ladeWetter(einsatzId: number): Promise<WetterAnzeige> {
  return apiGet<WetterAnzeige>(`/api/einsaetze/${einsatzId}/wetter`);
}

/** Nachfrage alle 5 min wie die Pegel — kein Live-Ereignis (externe Quelle). */
export function wetterAbfrage(einsatzId: number) {
  return {
    queryKey: einsatzKeys.wetter(einsatzId),
    queryFn: () => ladeWetter(einsatzId),
    refetchInterval: PEGEL_ABRUF_MS,
  };
}
