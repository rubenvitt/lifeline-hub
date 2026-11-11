import { apiGet, apiSend } from './client';
import type { BruchAlleErgebnis, BruchErfassung } from './types';

/**
 * Nicht übernommene Erfassungen am Spiegel (LLH-1646, Entwurf N1–N6): was diese Instanz nach einer
 * Notübernahme geschrieben hat und der neue Führer nicht kannte. Offen, nach Zeit; Inhalte nur
 * mit Freigabe des Moduls.
 */
export function loadBruchstelle(einsatzId: number): Promise<BruchErfassung[]> {
  return apiGet<BruchErfassung[]>(`/api/einsaetze/${einsatzId}/bruchstelle`);
}

/** Stellt eine Erfassung als Antrag an den Führer (202 mit dem Antrag). */
export function stelleBruchAntrag(
  einsatzId: number,
  bruchId: number,
): Promise<{ antrag: { id: number; zustand: string } }> {
  return apiSend(`/api/einsaetze/${einsatzId}/bruchstelle/${bruchId}/antrag`, 'POST', {});
}

/** Stellt alle nachreichbaren Erfassungen in der Reihenfolge ihrer Zeit. */
export function stelleAlleBruchAntraege(einsatzId: number): Promise<BruchAlleErgebnis> {
  return apiSend<BruchAlleErgebnis>(`/api/einsaetze/${einsatzId}/bruchstelle/antraege`, 'POST', {});
}

/** Legt eine Erfassung ab (204). */
export function verwirfBruch(einsatzId: number, bruchId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/bruchstelle/${bruchId}/verwerfen`, 'POST', {});
}
