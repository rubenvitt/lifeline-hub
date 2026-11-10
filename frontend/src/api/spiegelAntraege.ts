import { apiGet, apiSend } from './client';
import type { SpiegelAntragAnzeige } from './types';

/**
 * Anträge am Spiegel (LLH-1492, Spec `spiegel-antraege`, design.md D9): die eigenen offenen,
 * abgelehnten und übernommenen (deren Zeile der Spiegel noch nicht hat) Anträge der Person.
 */
export function loadAntraege(einsatzId: number): Promise<SpiegelAntragAnzeige[]> {
  return apiGet<SpiegelAntragAnzeige[]>(`/api/einsaetze/${einsatzId}/antraege`);
}

/** Verwirft einen eigenen, abgelehnten Antrag (204; sonst 404). */
export function verwerfeAntrag(einsatzId: number, antragId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/antraege/${antragId}`, 'DELETE');
}
