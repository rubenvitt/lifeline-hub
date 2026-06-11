import { apiGet, apiSend } from './client';
import type { Erinnerung, NeueErinnerung } from './types';

export function listeErinnerungen(einsatzId: number, nurOffen = false): Promise<Erinnerung[]> {
  const q = nurOffen ? '?nur_offen=true' : '';
  return apiGet<Erinnerung[]>(`/api/einsaetze/${einsatzId}/erinnerungen${q}`);
}

export function legeErinnerungAn(einsatzId: number, daten: NeueErinnerung): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/einsaetze/${einsatzId}/erinnerungen`, 'POST', daten);
}

export function erledigeErinnerung(einsatzId: number, id: number): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/einsaetze/${einsatzId}/erinnerungen/${id}/erledigen`, 'POST');
}

export function quittiereErinnerung(einsatzId: number, id: number): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/einsaetze/${einsatzId}/erinnerungen/${id}/quittieren`, 'POST');
}
