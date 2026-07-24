import type { KartenAnsicht, NeueKartenAnsicht, PatchKartenAnsicht } from './types';
import { apiGet, apiSend } from './client';

/** Kartenansichten eines Einsatzes (LFH-319). Der GET legt lazy die einsatzweit
 *  geteilte Standardansicht an (Seed aus den Einsatz-Einstellungen). */
export function ladeKartenAnsichten(einsatzId: number): Promise<KartenAnsicht[]> {
  return apiGet<KartenAnsicht[]>(`/api/einsaetze/${einsatzId}/karten-ansichten`);
}

/** „Für den Einsatz speichern" / Umbenennen / Standard setzen — je nach gesetzten Feldern. */
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

/** „Als neue Ansicht speichern" (LFH-320): legt eine weitere, benannte Ansicht an. */
export function erstelleKartenAnsicht(
  einsatzId: number,
  daten: NeueKartenAnsicht,
): Promise<KartenAnsicht> {
  return apiSend<KartenAnsicht>(`/api/einsaetze/${einsatzId}/karten-ansichten`, 'POST', daten);
}

/** Löscht eine Ansicht (LFH-320). `objekte` bestimmt das Schicksal der gebundenen Objekte:
 *  `freigeben` (Default) → auf allen Ansichten sichtbar; `loeschen` → mitlöschen. */
export function loescheKartenAnsicht(
  einsatzId: number,
  ansichtId: number,
  objekte: 'freigeben' | 'loeschen' = 'freigeben',
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/karten-ansichten/${ansichtId}?objekte=${objekte}`,
    'DELETE',
  );
}
