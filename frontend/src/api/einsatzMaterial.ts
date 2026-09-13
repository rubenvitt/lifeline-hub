import type { EinsatzMaterial, MaterialStatus } from './types';
import { apiGet, apiSend } from './client';

export interface MaterialAdhocEingabe {
  bezeichnung: string;
  kategorie?: string | null;
  bestandsnummer?: string | null;
  traegerorganisation?: string | null;
}

export function listeEinsatzMaterial(einsatzId: number): Promise<EinsatzMaterial[]> {
  return apiGet<EinsatzMaterial[]>(`/api/einsaetze/${einsatzId}/material`);
}

export function disponiereMaterial(
  einsatzId: number,
  materialId: number,
  menge: number,
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material`, 'POST', {
    material_id: materialId,
    menge,
  });
}

// menge wird separat übergeben, da es keine Stamm-Eigenschaft des Ad-hoc-Materials ist.
export function disponiereAdhoc(
  einsatzId: number,
  adhoc: MaterialAdhocEingabe,
  menge: number,
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material`, 'POST', { adhoc, menge });
}

export function aktualisiereDisposition(
  einsatzId: number,
  emId: number,
  felder: { menge?: number; status?: MaterialStatus; bemerkung?: string; uhs_id?: number | null },
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material/${emId}`, 'PATCH', felder);
}

export function entferneDisposition(einsatzId: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/material/${emId}`, 'DELETE');
}

export function ordneMaterialZu(einsatzId: number, eid: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/material/${emId}`, 'PUT');
}

export function gibMaterialFrei(einsatzId: number, eid: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/material/${emId}`, 'DELETE');
}
