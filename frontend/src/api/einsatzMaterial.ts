import type { EinsatzMaterial, MaterialStatus } from './types';
import { apiGet, apiSend } from './client';

export interface MaterialAdhocEingabe {
  bezeichnung: string;
  kategorie?: string | null;
  bestandsnummer?: string | null;
  traegerorganisation?: string | null;
}

export function listEinsatzMaterial(einsatzId: number): Promise<EinsatzMaterial[]> {
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

export function updateDisposition(
  einsatzId: number,
  emId: number,
  felder: { menge?: number; status?: MaterialStatus; bemerkung?: string; uhs_id?: number | null },
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material/${emId}`, 'PATCH', felder);
}

/**
 * Aus dem Einsatz genommenes Material (LLH-1079 Teil II, Block „Aus dem Einsatz genommen“). Auf
 * dem Draht heißt der Endzustand wie bei jeder Kraft `entlassen`.
 */
export function listEntlassenesMaterial(einsatzId: number): Promise<EinsatzMaterial[]> {
  return apiGet<EinsatzMaterial[]>(`/api/einsaetze/${einsatzId}/material?entlassene=1`);
}

/**
 * Aus dem Einsatz nehmen (LLH-1079, Wortlaut LLH-1093): die Zeile bleibt, Einheit und UHS gehen.
 * Umkehrbar über {@link reaktiviereDisposition}, deshalb ohne Rückfrage.
 */
export function nimmAusDemEinsatz(einsatzId: number, emId: number): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material/${emId}/entlassen`, 'POST');
}

/** Fehldisposition stornieren (LLH-1079): nur ohne Einheit und UHS in den ersten 15 Minuten. */
export function storniereDisposition(einsatzId: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/material/${emId}/stornieren`, 'POST');
}

/** Herausgenommenes oder storniertes Material erneut disponieren (Rückgängig, Block). */
export function reaktiviereDisposition(einsatzId: number, emId: number): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(
    `/api/einsaetze/${einsatzId}/material/${emId}/reaktivieren`,
    'POST',
  );
}

export function ordneMaterialZu(einsatzId: number, eid: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/material/${emId}`, 'PUT');
}

export function gibMaterialFrei(einsatzId: number, eid: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/material/${emId}`, 'DELETE');
}
