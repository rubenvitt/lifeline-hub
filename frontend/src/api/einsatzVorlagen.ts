import { apiGet, apiSend } from './client';
import type { EinsatzVorlage, EinsatzVorlageEingabe } from './types';

/**
 * Einsatz-Vorlagen der Organisation (LLH-1375, Spec `einsatz-vorlagen`). Lesen jedes Mitglied,
 * schreiben nur der System-Admin; jede Änderung meldet das Org-Ereignis `stammdaten`.
 */

/** Die Vorlagen der eigenen Organisation in der Reihenfolge des Servers (`sortier`). */
export function listeEinsatzVorlagen(): Promise<EinsatzVorlage[]> {
  return apiGet<EinsatzVorlage[]>('/api/incident-templates');
}

export function legeEinsatzVorlageAn(daten: EinsatzVorlageEingabe): Promise<EinsatzVorlage> {
  return apiSend<EinsatzVorlage>('/api/incident-templates', 'POST', daten);
}

/** Vollersatz: Bezeichnung, Einsatzart, Schichtmodell und die ganze Menge ausgeblendeter Module. */
export function aktualisiereEinsatzVorlage(
  id: number,
  daten: EinsatzVorlageEingabe,
): Promise<EinsatzVorlage> {
  return apiSend<EinsatzVorlage>(`/api/incident-templates/${id}`, 'PUT', daten);
}

/** Gekoppelte Stichworte verlieren die Kopplung, die Stichworte bleiben. */
export function loescheEinsatzVorlage(id: number): Promise<void> {
  return apiSend<void>(`/api/incident-templates/${id}`, 'DELETE');
}
