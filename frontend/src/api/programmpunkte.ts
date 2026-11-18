import { apiGet, apiSend } from './client';
import type { Programmpunkt } from './types';

/** Eingabe eines Programmpunkts (LLH-1570); `zeitpunkt_at` als Wire-Zeit (UTC ohne Zone). */
export interface ProgrammpunktEingabe {
  bezeichnung: string;
  zeitpunkt_at: string;
}

/** Alle Programmpunkte des Einsatzes nach Zeitpunkt, auch verstrichene. */
export function ladeProgrammpunkte(einsatzId: number): Promise<Programmpunkt[]> {
  return apiGet<Programmpunkt[]>(`/api/einsaetze/${einsatzId}/programmpunkte`);
}

export function legeProgrammpunktAn(
  einsatzId: number,
  daten: ProgrammpunktEingabe,
): Promise<Programmpunkt> {
  return apiSend<Programmpunkt>(`/api/einsaetze/${einsatzId}/programmpunkte`, 'POST', daten);
}

/**
 * Ändert Bezeichnung und/oder Zeitpunkt. `erwartet` trägt je geänderter Angabe ihren Wert beim
 * Öffnen (Feld-CAS, LLH-1945): hat sie ein anderer inzwischen geändert, antwortet der Server 409
 * `veraltet`; ohne `erwartet` schreibt er ohne Vergleich.
 */
export function aendereProgrammpunkt(
  einsatzId: number,
  id: number,
  daten: Partial<ProgrammpunktEingabe>,
  erwartet?: Partial<ProgrammpunktEingabe>,
): Promise<Programmpunkt> {
  return apiSend<Programmpunkt>(
    `/api/einsaetze/${einsatzId}/programmpunkte/${id}`,
    'PATCH',
    erwartet ? { ...daten, erwartet } : daten,
  );
}

export function loescheProgrammpunkt(einsatzId: number, id: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/programmpunkte/${id}`, 'DELETE');
}
