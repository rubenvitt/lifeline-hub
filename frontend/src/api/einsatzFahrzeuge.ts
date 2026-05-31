import type { EinsatzFahrzeug } from './types';
import { apiGet, apiSend } from './client';
import type { PositionPatch } from './einheiten';

export type { PositionPatch } from './einheiten';

export interface AdhocEingabe {
  funkrufname: string;
  fahrzeugtyp?: string | null;
  kennzeichen?: string | null;
  opta?: string | null;
  traegerorganisation?: string | null;
}

export function listeEinsatzFahrzeuge(einsatzId: number): Promise<EinsatzFahrzeug[]> {
  return apiGet<EinsatzFahrzeug[]>(`/api/einsaetze/${einsatzId}/fahrzeuge`);
}

export function disponiereFahrzeug(einsatzId: number, fahrzeugId: number): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge`, 'POST', {
    fahrzeug_id: fahrzeugId,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge`, 'POST', { adhoc });
}

export function aktualisiereDisposition(
  einsatzId: number,
  efId: number,
  felder: { status_id?: number; bemerkung?: string },
): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}`, 'PATCH', felder);
}

export function entferneDisposition(einsatzId: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}`, 'DELETE');
}

/** L‑2: Verortet ein Einsatzfahrzeug auf der Lagekarte. */
export function verorteFahrzeug(einsatzId: number, efId: number, daten: PositionPatch): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/position`, 'PATCH', daten);
}
