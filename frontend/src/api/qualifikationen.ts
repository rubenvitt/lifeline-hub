import type { Qualifikation } from './types';
import { apiGet, apiSend } from './client';

export interface QualifikationEingabe {
  label: string;
  sortier: number;
}

export function listeQualifikationen(): Promise<Qualifikation[]> {
  return apiGet<Qualifikation[]>('/api/qualifikationen');
}

export function legeQualifikationAn(daten: QualifikationEingabe): Promise<Qualifikation> {
  return apiSend<Qualifikation>('/api/qualifikationen', 'POST', daten);
}

export function aktualisiereQualifikation(
  id: number,
  daten: QualifikationEingabe,
): Promise<Qualifikation> {
  return apiSend<Qualifikation>(`/api/qualifikationen/${id}`, 'PATCH', daten);
}

export function deaktiviereQualifikation(id: number): Promise<void> {
  return apiSend<void>(`/api/qualifikationen/${id}/deaktivieren`, 'POST');
}
