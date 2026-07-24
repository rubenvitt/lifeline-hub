import type { KartenAnsicht, PatchKartenAnsicht } from './types';
import { apiGet, apiSend } from './client';

/** Kartenansichten eines Einsatzes (LFH-319). Der GET legt lazy die einsatzweit
 *  geteilte Standardansicht an (Seed aus den Einsatz-Einstellungen). */
export function ladeKartenAnsichten(einsatzId: number): Promise<KartenAnsicht[]> {
  return apiGet<KartenAnsicht[]>(`/api/einsaetze/${einsatzId}/karten-ansichten`);
}

/** „Für den Einsatz speichern": Konfiguration einer Ansicht überschreiben. */
export function patcheKartenAnsicht(
  einsatzId: number,
  ansichtId: number,
  daten: PatchKartenAnsicht,
): Promise<KartenAnsicht> {
  return apiSend<KartenAnsicht>(
    `/api/einsaetze/${einsatzId}/karten-ansichten/${ansichtId}`,
    'PATCH',
    daten,
  );
}
