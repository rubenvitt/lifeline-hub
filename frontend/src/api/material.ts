import type { Material } from './types';
import { apiGet, apiSend } from './client';
import { setzeDienststatusUnter } from './katalogApi';

/** Editierbare Stammfelder (Anlegen + Vollersatz-PATCH). */
export interface MaterialEingabe {
  bezeichnung: string;
  kategorie: string | null;
  bestandsnummer: string | null;
  traegerorganisation: string | null;
  standort: string | null;
  bemerkung: string | null;
}

export function listeMaterial(nurImDienst = false): Promise<Material[]> {
  const qs = nurImDienst ? '?nur_im_dienst=true' : '';
  return apiGet<Material[]>(`/api/material${qs}`);
}

/** Gibt alle org-weit verwendeten Materialkategorien (DISTINCT) zurück. */
export function listeKategorien(): Promise<string[]> {
  return apiGet<string[]>('/api/material-kategorien');
}

export function legeMaterialAn(daten: MaterialEingabe): Promise<Material> {
  return apiSend<Material>('/api/material', 'POST', daten);
}

export function aktualisiereMaterial(id: number, daten: MaterialEingabe): Promise<Material> {
  return apiSend<Material>(`/api/material/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Material> {
  return setzeDienststatusUnter<Material>('/api/material', id, inDienst);
}
