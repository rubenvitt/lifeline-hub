import type { StichwortVorschlag } from './types';
import { apiGet, apiSend } from './client';

export function listeStichwortVorschlaege(): Promise<StichwortVorschlag[]> {
  return apiGet<StichwortVorschlag[]>('/api/keyword-suggestions');
}

export function legeStichwortVorschlagAn(text: string): Promise<StichwortVorschlag> {
  return apiSend<StichwortVorschlag>('/api/keyword-suggestions', 'POST', { text });
}

export function loescheStichwortVorschlag(id: number): Promise<void> {
  return apiSend<void>(`/api/keyword-suggestions/${id}`, 'DELETE');
}

/**
 * Koppelt einen Vorschlag an eine Einsatz-Vorlage (LLH-1375); `null` löst die Kopplung. Nur der
 * System-Admin.
 */
export function setzeStichwortVorlage(
  id: number,
  vorlageId: number | null,
): Promise<StichwortVorschlag> {
  return apiSend<StichwortVorschlag>(`/api/keyword-suggestions/${id}/template`, 'PUT', {
    vorlage_id: vorlageId,
  });
}
