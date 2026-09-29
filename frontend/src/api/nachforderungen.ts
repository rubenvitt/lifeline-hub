import { apiGet, apiSend, mitParametern } from './client';
import type { Nachforderung, NachforderungStatus, NeueNachforderung } from './types';

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
