import type { StichwortVorschlag } from './types';
import { apiGet, apiSend } from './client';

export function listeStichwortVorschlaege(): Promise<StichwortVorschlag[]> {
  return apiGet<StichwortVorschlag[]>('/api/stichwort-vorschlaege');
}

export function legeStichwortVorschlagAn(text: string): Promise<StichwortVorschlag> {
  return apiSend<StichwortVorschlag>('/api/stichwort-vorschlaege', 'POST', { text });
}

export function loescheStichwortVorschlag(id: number): Promise<void> {
  return apiSend<void>(`/api/stichwort-vorschlaege/${id}`, 'DELETE');
}

/**
 * Koppelt einen Vorschlag an eine Einsatz-Vorlage (LLH-1375); `null` löst die Kopplung. Nur der
 * System-Admin.
 */
export function setzeStichwortVorlage(
  id: number,
  vorlageId: number | null,
): Promise<StichwortVorschlag> {
  return apiSend<StichwortVorschlag>(`/api/stichwort-vorschlaege/${id}/vorlage`, 'PUT', {
    vorlage_id: vorlageId,
  });
}
