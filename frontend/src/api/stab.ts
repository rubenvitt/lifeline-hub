import { apiGet, apiSend } from './client';
import type { BesetzungBody, Sachgebiet, Stab } from './types';

/** Führungsorganisation eines Einsatzes (LFH-46). `besetzung` trägt nur belegte Zeilen. */
export function ladeStab(einsatzId: number): Promise<Stab> {
  return apiGet<Stab>(`/api/einsaetze/${einsatzId}/stab`);
}

export function setzeBesetzung(
  einsatzId: number,
  sachgebiet: Sachgebiet,
  daten: BesetzungBody,
): Promise<Stab> {
  return apiSend<Stab>(`/api/einsaetze/${einsatzId}/stab/besetzung/${sachgebiet}`, 'PUT', daten);
}

/** 204 ohne Body — auch auf einer leeren Zeile (idempotent, Spec 9.2). */
export function entferneBesetzung(einsatzId: number, sachgebiet: Sachgebiet): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/stab/besetzung/${sachgebiet}`, 'DELETE');
}
