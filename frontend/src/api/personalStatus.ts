import type { PersonalStatus, StatusKategorie } from './types';
import { apiGet, apiSend } from './client';

export interface StatusEingabe {
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  sortier: number;
}

export function listePersonalStatus(): Promise<PersonalStatus[]> {
  return apiGet<PersonalStatus[]>('/api/personal-status');
}

export function legeStatusAn(daten: StatusEingabe): Promise<PersonalStatus> {
  return apiSend<PersonalStatus>('/api/personal-status', 'POST', daten);
}

export function aktualisiereStatus(id: number, daten: StatusEingabe): Promise<PersonalStatus> {
  return apiSend<PersonalStatus>(`/api/personal-status/${id}`, 'PATCH', daten);
}

export function deaktiviereStatus(id: number): Promise<void> {
  return apiSend<void>(`/api/personal-status/${id}/deaktivieren`, 'POST');
}
