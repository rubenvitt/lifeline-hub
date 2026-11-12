import { apiGet, apiSend } from './client';
import type { AbgelehnterAntragAnzeige, SpiegelAntragAnzeige } from './types';

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

/**
 * Die eigenen abgelehnten Anträge an Einsätzen, die kein Spiegel mehr sind (LLH-1648): nach der
 * Verwahrung am Hub gibt es das Hinweisband nicht mehr, und nach der Schonfrist liest die Person
 * den Einsatz nicht mehr. Einsatzübergreifend, bis die Frist abgelaufen ist.
 */
export function loadAbgelehnteAntraege(): Promise<AbgelehnterAntragAnzeige[]> {
  return apiGet<AbgelehnterAntragAnzeige[]>('/api/antraege/abgelehnt');
}

/** Verwirft einen davon (204; sonst 404). */
export function verwerfeAbgelehntenAntrag(antragId: number): Promise<void> {
  return apiSend<void>(`/api/antraege/abgelehnt/${antragId}`, 'DELETE');
}
