import type { FahrzeugStatus, StatusKategorie } from './types';
import { apiGet, apiSend } from './client';

export interface StatusEingabe {
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  fms_anker: number | null;
  sortier: number;
}

export function listeFahrzeugStatus(): Promise<FahrzeugStatus[]> {
  return apiGet<FahrzeugStatus[]>('/api/fahrzeug-status');
}

export function legeStatusAn(daten: StatusEingabe): Promise<FahrzeugStatus> {
  return apiSend<FahrzeugStatus>('/api/fahrzeug-status', 'POST', daten);
}

export function aktualisiereStatus(id: number, daten: StatusEingabe): Promise<FahrzeugStatus> {
  return apiSend<FahrzeugStatus>(`/api/fahrzeug-status/${id}`, 'PATCH', daten);
}

export function deaktiviereStatus(id: number): Promise<void> {
  return apiSend<void>(`/api/fahrzeug-status/${id}/deaktivieren`, 'POST');
}
