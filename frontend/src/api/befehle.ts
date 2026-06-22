import { apiGet, apiSend } from './client';
import type { BefehlAbschnitt, BefehlAnzeige, BefehlVorlageKey } from './types';

export function listeBefehle(einsatzId: number): Promise<BefehlAnzeige[]> {
  return apiGet<BefehlAnzeige[]>(`/api/einsaetze/${einsatzId}/befehle`);
}

export function ladeBefehl(einsatzId: number, id: number): Promise<BefehlAnzeige> {
  return apiGet<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/befehle/${id}`);
}

export interface NeuerBefehl {
  vorlage: BefehlVorlageKey;
  titel: string;
  zeitstand?: string;
}

export function legeBefehlAn(einsatzId: number, daten: NeuerBefehl): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/befehle`, 'POST', daten);
}

export interface BefehlPatch {
  titel?: string;
  zeitstand?: string;
  abschnitte?: BefehlAbschnitt[];
}

export function aktualisiereBefehl(
  einsatzId: number,
  id: number,
  patch: BefehlPatch,
): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/befehle/${id}`, 'PATCH', patch);
}

export function gibBefehlFrei(einsatzId: number, id: number): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/befehle/${id}/freigeben`, 'POST');
}

export function schreibeBefehlFort(
  einsatzId: number,
  id: number,
  zeitstand?: string,
): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(
    `/api/einsaetze/${einsatzId}/befehle/${id}/fortschreiben`,
    'POST',
    { zeitstand },
  );
}
