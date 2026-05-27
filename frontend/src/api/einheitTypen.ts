import type { EinheitTyp } from './types';
import { apiGet, apiSend } from './client';

export interface TypEingabe {
  label: string;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  sortier: number;
}

export function listeEinheitTypen(): Promise<EinheitTyp[]> {
  return apiGet<EinheitTyp[]>('/api/einheit-typen');
}

export function legeTypAn(daten: TypEingabe): Promise<EinheitTyp> {
  return apiSend<EinheitTyp>('/api/einheit-typen', 'POST', daten);
}

export function aktualisiereTyp(id: number, daten: TypEingabe): Promise<EinheitTyp> {
  return apiSend<EinheitTyp>(`/api/einheit-typen/${id}`, 'PATCH', daten);
}

export function deaktiviereTyp(id: number): Promise<void> {
  return apiSend<void>(`/api/einheit-typen/${id}/deaktivieren`, 'POST');
}
