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
  return apiGet<EtbBaustein[]>('/api/etb-snippets');
}

export function legeBausteinAn(daten: BausteinEingabe): Promise<EtbBaustein> {
  return apiSend<EtbBaustein>('/api/etb-snippets', 'POST', daten);
}

export function aktualisiereBaustein(id: number, daten: BausteinEingabe): Promise<EtbBaustein> {
  return apiSend<EtbBaustein>(`/api/etb-snippets/${id}`, 'PATCH', daten);
}

export function deaktiviereBaustein(id: number): Promise<void> {
  return apiSend<void>(`/api/etb-snippets/${id}/deactivate`, 'POST');
}
