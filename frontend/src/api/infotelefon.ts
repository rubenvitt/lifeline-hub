import { apiGet, apiSend } from './client';
import type { InfotelefonAnliegen, InfotelefonAnruf, InfotelefonStatus } from './types';

/**
 * Informationstelefon S5 (LFH-554): Anrufprotokoll unter dem Stab. Name, Rückrufnummer und
 * Notiz sind personenbezogen; sie erscheinen in keiner Ableitung (Medienlage, Lagebericht).
 */
const pfad = (einsatzId: number) => `/api/einsaetze/${einsatzId}/stab/infotelefon`;

/** Jüngster Eingang zuerst (Ordnung vom Server). */
export function ladeAnrufe(einsatzId: number): Promise<InfotelefonAnruf[]> {
  return apiGet<InfotelefonAnruf[]>(pfad(einsatzId));
}

/** Kein Backend-Schema: Eingabe-Body von `POST …/stab/infotelefon`. */
export interface AnrufEingabe {
  anliegen: InfotelefonAnliegen;
  notiz?: string;
  anrufer_name?: string;
  rueckruf?: string;
  /** Mit Rückruf beginnt der Anruf `offen` und braucht `rueckruf` (sonst 422). */
  rueckruf_noetig?: boolean;
  /** Fehlt = jetzt. */
  eingang_at?: string;
}

export function erfasseAnruf(einsatzId: number, body: AnrufEingabe): Promise<InfotelefonAnruf> {
  return apiSend<InfotelefonAnruf>(pfad(einsatzId), 'POST', body);
}

/** Rückruf erledigen oder wieder öffnen. */
export function setzeAnrufStatus(
  einsatzId: number,
  anrufId: number,
  status: InfotelefonStatus,
): Promise<InfotelefonAnruf> {
  return apiSend<InfotelefonAnruf>(`${pfad(einsatzId)}/${anrufId}/status`, 'POST', { status });
}
