import { apiGet, apiSend, mitParametern } from './client';
import type {
  Nachforderung,
  NachforderungStatus,
  NachforderungZusageEingabe,
  NeueNachforderung,
  PatchNachforderung,
} from './types';

interface NachforderungFilter {
  status?: string;
}

export function listeNachforderungen(
  einsatzId: number,
  filter: NachforderungFilter = {},
): Promise<Nachforderung[]> {
  return apiGet<Nachforderung[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/nachforderungen`, { status: filter.status }),
  );
}

export function legeNachforderungAn(
  einsatzId: number,
  daten: NeueNachforderung,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(`/api/einsaetze/${einsatzId}/nachforderungen`, 'POST', daten);
}

/** Bedarfs-Status weiterschalten (linear: zugesagt/unterwegs/eingetroffen). */
export function setzeNachforderungStatus(
  einsatzId: number,
  nachforderungId: number,
  status: NachforderungStatus,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(
    `/api/einsaetze/${einsatzId}/nachforderungen/${nachforderungId}/status`,
    'POST',
    { status },
  );
}

/** Nachforderung ablehnen (Abzweig) mit optionalem Grund. */
export function lehneNachforderungAb(
  einsatzId: number,
  nachforderungId: number,
  grund?: string,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(
    `/api/einsaetze/${einsatzId}/nachforderungen/${nachforderungId}/ablehnen`,
    'POST',
    { grund },
  );
}

/** Zusage mit Menge, Wer und voraussichtlichem Eintreffen erfassen (LLH-1097 D4). */
export function erfasseZusage(
  einsatzId: number,
  nachforderungId: number,
  zusage: NachforderungZusageEingabe,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(
    `/api/einsaetze/${einsatzId}/nachforderungen/${nachforderungId}/zusage`,
    'POST',
    zusage,
  );
}

/** Nachforderung durch die eigene Führung zurückziehen (terminal, LLH-1097 D8). */
export function zieheNachforderungZurueck(
  einsatzId: number,
  nachforderungId: number,
  grund?: string,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(
    `/api/einsaetze/${einsatzId}/nachforderungen/${nachforderungId}/zurueckziehen`,
    'POST',
    { grund },
  );
}

/** Offene Nachforderung bearbeiten, nur geänderte Felder (LLH-1097 D9). */
export function patcheNachforderung(
  einsatzId: number,
  nachforderungId: number,
  aenderung: PatchNachforderung,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(
    `/api/einsaetze/${einsatzId}/nachforderungen/${nachforderungId}`,
    'PATCH',
    aenderung,
  );
}
