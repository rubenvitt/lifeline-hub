import type { FreiesZeichen, NeuesFreiesZeichen, FreiesZeichenPatch } from './types';
import { apiGet, apiSend } from './client';

/** Freie taktische Zeichen eines Einsatzes (LFH-170). */
export function listeFreieZeichen(einsatzId: number): Promise<FreiesZeichen[]> {
  return apiGet<FreiesZeichen[]>(`/api/incidents/${einsatzId}/free-symbols`);
}

/**
 * `fremdebene_id` (LLH-2129) nur hier, nicht in `NeuesFreiesZeichen`: sonst erbte der PATCH-Typ
 * `FreiesZeichenUpdate` das Feld. Mit ihm schreibt der Server einen System-ETB-Eintrag.
 */
export function legeFreiesZeichenAn(
  einsatzId: number,
  daten: NeuesFreiesZeichen & { fremdebene_id?: number },
): Promise<FreiesZeichen> {
  return apiSend<FreiesZeichen>(`/api/incidents/${einsatzId}/free-symbols`, 'POST', daten);
}

export function aktualisiereFreiesZeichen(
  einsatzId: number,
  id: number,
  daten: FreiesZeichenPatch,
): Promise<FreiesZeichen> {
  return apiSend<FreiesZeichen>(`/api/incidents/${einsatzId}/free-symbols/${id}`, 'PATCH', daten);
}

export function loescheFreiesZeichen(einsatzId: number, id: number): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/free-symbols/${id}`, 'DELETE');
}

/** Verschiebt ein freies Zeichen auf eine Ansicht (`null` = auf alle Ansichten). Echter
 *  Teil-Patch (nur `ansicht_id`) — die übrigen Felder bleiben unverändert (LFH-320). */
export function verschiebeFreiesZeichen(
  einsatzId: number,
  id: number,
  ansichtId: number | null,
): Promise<FreiesZeichen> {
  return apiSend<FreiesZeichen>(`/api/incidents/${einsatzId}/free-symbols/${id}`, 'PATCH', {
    ansicht_id: ansichtId,
  });
}
