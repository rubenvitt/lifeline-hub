import type { FreiesZeichen, NeuesFreiesZeichen, FreiesZeichenUpdate } from './types';
import { apiGet, apiSend } from './client';

/** Freie taktische Zeichen eines Einsatzes (LFH-170). */
export function listeFreieZeichen(einsatzId: number): Promise<FreiesZeichen[]> {
  return apiGet<FreiesZeichen[]>(`/api/einsaetze/${einsatzId}/freie-zeichen`);
}

export function legeFreiesZeichenAn(einsatzId: number, daten: NeuesFreiesZeichen): Promise<FreiesZeichen> {
  return apiSend<FreiesZeichen>(`/api/einsaetze/${einsatzId}/freie-zeichen`, 'POST', daten);
}

export function aktualisiereFreiesZeichen(
  einsatzId: number,
  id: number,
  daten: FreiesZeichenUpdate,
): Promise<FreiesZeichen> {
  return apiSend<FreiesZeichen>(`/api/einsaetze/${einsatzId}/freie-zeichen/${id}`, 'PATCH', daten);
}

export function loescheFreiesZeichen(einsatzId: number, id: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/freie-zeichen/${id}`, 'DELETE');
}

/** Verschiebt ein freies Zeichen auf eine Ansicht (`null` = auf alle Ansichten). Echter
 *  Teil-Patch (nur `ansicht_id`) — die übrigen Felder bleiben unverändert (LFH-320). */
export function verschiebeFreiesZeichen(
  einsatzId: number,
  id: number,
  ansichtId: number | null,
): Promise<FreiesZeichen> {
  return apiSend<FreiesZeichen>(`/api/einsaetze/${einsatzId}/freie-zeichen/${id}`, 'PATCH', {
    ansicht_id: ansichtId,
  });
}
