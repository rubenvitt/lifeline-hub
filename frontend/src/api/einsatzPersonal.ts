import type { EinsatzPersonal, StaerkePosition } from './types';
import { apiGet, apiSend } from './client';

export interface AdhocEingabe {
  name: string;
  funktion?: string | null;
  traegerorganisation?: string | null;
  staerke_position?: StaerkePosition | null;
}

export function listeEinsatzPersonal(einsatzId: number): Promise<EinsatzPersonal[]> {
  return apiGet<EinsatzPersonal[]>(`/api/einsaetze/${einsatzId}/personal`);
}

export function disponierePerson(
  einsatzId: number,
  personalId: number,
  staerkePosition?: StaerkePosition | null,
): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal`, 'POST', {
    personal_id: personalId,
    staerke_position: staerkePosition ?? null,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal`, 'POST', { adhoc });
}

export function aktualisiereDisposition(
  einsatzId: number,
  epId: number,
  felder: { status_id?: number; staerke_position?: StaerkePosition; bemerkung?: string },
): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal/${epId}`, 'PATCH', felder);
}

export function entferneDisposition(einsatzId: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personal/${epId}`, 'DELETE');
}
