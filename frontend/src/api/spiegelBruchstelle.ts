import { apiGet, apiSend } from './client';
import type { BruchAlleErgebnis, BruchErfassung } from './types';

/**
 * Nicht übernommene Erfassungen am Spiegel (LLH-1646, Entwurf N1–N6): was diese Instanz nach einer
 * Notübernahme geschrieben hat und der neue Führer nicht kannte. Offen, nach Zeit; Inhalte nur
 * mit Freigabe des Moduls.
 */
export function loadBruchstelle(einsatzId: number): Promise<BruchErfassung[]> {
  return apiGet<BruchErfassung[]>(`/api/incidents/${einsatzId}/breaks`);
}

/** Stellt eine Erfassung als Antrag an den Führer (202 mit dem Antrag). */
export function stelleBruchAntrag(
  einsatzId: number,
  bruchId: number,
): Promise<{ antrag: { id: number; zustand: string } }> {
  return apiSend(`/api/incidents/${einsatzId}/breaks/${bruchId}/request`, 'POST', {});
}

/** Stellt alle nachreichbaren Erfassungen in der Reihenfolge ihrer Zeit. */
export function stelleAlleBruchAntraege(einsatzId: number): Promise<BruchAlleErgebnis> {
  return apiSend<BruchAlleErgebnis>(`/api/incidents/${einsatzId}/breaks/requests`, 'POST', {});
}

/** Legt eine Erfassung ab (204). */
export function verwirfBruch(einsatzId: number, bruchId: number): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/breaks/${bruchId}/discard`, 'POST', {});
}
