import { apiGet, apiSend } from './client';
import type {
  BefehlAbschnitt,
  BefehlAnzeige,
  BefehlKopf,
  BefehlVorlageKey,
  NeuerEmpfaenger,
} from './types';

/** Kopfdaten ohne Abschnitte (LFH-931); den Text liefert nur das Detail. */
export function listeBefehle(einsatzId: number): Promise<BefehlKopf[]> {
  return apiGet<BefehlKopf[]>(`/api/einsaetze/${einsatzId}/orders`);
}

export function ladeBefehl(einsatzId: number, id: number): Promise<BefehlAnzeige> {
  return apiGet<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/orders/${id}`);
}

export interface NeuerBefehl {
  vorlage: BefehlVorlageKey;
  titel: string;
  zeitstand?: string;
  /** Startinhalt (LFH-548), siehe `NeuerLagebericht.abschnitte`. */
  abschnitte?: BefehlAbschnitt[];
}

export function legeBefehlAn(einsatzId: number, daten: NeuerBefehl): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/orders`, 'POST', daten);
}

interface BefehlPatch {
  titel?: string;
  zeitstand?: string;
  abschnitte?: BefehlAbschnitt[];
  /** Ersetzt den Verteiler ganz (LLH-1172); leer leert ihn, fehlt = unverändert. */
  verteiler?: NeuerEmpfaenger[];
}

export function aktualisiereBefehl(
  einsatzId: number,
  id: number,
  patch: BefehlPatch,
): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/orders/${id}`, 'PATCH', patch);
}

export function gibBefehlFrei(einsatzId: number, id: number): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/orders/${id}/release`, 'POST');
}

export function schreibeBefehlFort(
  einsatzId: number,
  id: number,
  zeitstand?: string,
): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(`/api/einsaetze/${einsatzId}/orders/${id}/revise`, 'POST', {
    zeitstand,
  });
}

/** Empfang einer Verteiler-Zeile quittieren (LLH-1173); nur die jüngste freigegebene Fassung. */
export function quittiereBefehlEmpfang(
  einsatzId: number,
  id: number,
  eintragId: number,
): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(
    `/api/einsaetze/${einsatzId}/orders/${id}/distribution/${eintragId}/acknowledge`,
    'POST',
  );
}

/** Quittung einer Verteiler-Zeile zurücknehmen, der Rückweg zum Rückgängig-Knopf (LFH-343). */
export function nimmBefehlQuittungZurueck(
  einsatzId: number,
  id: number,
  eintragId: number,
): Promise<BefehlAnzeige> {
  return apiSend<BefehlAnzeige>(
    `/api/einsaetze/${einsatzId}/orders/${id}/distribution/${eintragId}/undo`,
    'POST',
  );
}
