import type { Personal, PersonalVorschlaege, StaerkePosition } from './types';
import { apiGet, apiSend } from './client';

/** Editierbare Stammfelder (Anlegen + Vollersatz-PATCH). */
export interface PersonalEingabe {
  name: string;
  benutzer_id: number | null;
  personalnummer: string | null;
  traegerorganisation: string | null;
  telefon: string | null;
  staerke_position: StaerkePosition | null;
  bemerkung: string | null;
  qualifikation_ids: number[];
}

export function listePersonal(nurImDienst = false): Promise<Personal[]> {
  const qs = nurImDienst ? '?nur_im_dienst=true' : '';
  return apiGet<Personal[]>(`/api/personal${qs}`);
}

export function ladePersonalVorschlaege(): Promise<PersonalVorschlaege> {
  return apiGet<PersonalVorschlaege>('/api/personal-vorschlaege');
}

export function legePersonAn(daten: PersonalEingabe): Promise<Personal> {
  return apiSend<Personal>('/api/personal', 'POST', daten);
}

export function aktualisierePerson(id: number, daten: PersonalEingabe): Promise<Personal> {
  return apiSend<Personal>(`/api/personal/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Personal> {
  const pfad = inDienst ? 'in-dienst' : 'ausser-dienst';
  return apiSend<Personal>(`/api/personal/${id}/${pfad}`, 'POST');
}
