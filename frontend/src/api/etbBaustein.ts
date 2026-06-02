import type { EtbBaustein, EtbTyp, MeldeWeg } from './types';
import { apiGet, apiSend } from './client';

export interface BausteinEingabe {
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg: MeldeWeg | null;
  veranlassung: string | null;
  sortier: number;
}

export function listeBausteine(): Promise<EtbBaustein[]> {
  return apiGet<EtbBaustein[]>('/api/etb-bausteine');
}

export function legeBausteinAn(daten: BausteinEingabe): Promise<EtbBaustein> {
  return apiSend<EtbBaustein>('/api/etb-bausteine', 'POST', daten);
}

export function aktualisiereBaustein(id: number, daten: BausteinEingabe): Promise<EtbBaustein> {
  return apiSend<EtbBaustein>(`/api/etb-bausteine/${id}`, 'PATCH', daten);
}

export function deaktiviereBaustein(id: number): Promise<void> {
  return apiSend<void>(`/api/etb-bausteine/${id}/deaktivieren`, 'POST');
}
