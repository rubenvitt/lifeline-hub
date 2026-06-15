import { apiGet, apiSend } from './client';
import type { Nachforderung, NachforderungStatus, NeueNachforderung } from './types';

export interface NachforderungFilter {
  status?: string;
}

export function listeNachforderungen(einsatzId: number, filter: NachforderungFilter = {}): Promise<Nachforderung[]> {
  const p = new URLSearchParams();
  if (filter.status) p.set('status', filter.status);
  const q = p.toString() ? `?${p.toString()}` : '';
  return apiGet<Nachforderung[]>(`/api/einsaetze/${einsatzId}/nachforderungen${q}`);
}

export function legeNachforderungAn(einsatzId: number, daten: NeueNachforderung): Promise<Nachforderung> {
  return apiSend<Nachforderung>(`/api/einsaetze/${einsatzId}/nachforderungen`, 'POST', daten);
}

/** Bedarfs-Status weiterschalten (linear: zugesagt/unterwegs/eingetroffen). */
export function setzeNachforderungStatus(
  einsatzId: number,
  nachforderungId: number,
  status: NachforderungStatus,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(`/api/einsaetze/${einsatzId}/nachforderungen/${nachforderungId}/status`, 'POST', { status });
}

/** Nachforderung ablehnen (Abzweig) mit optionalem Grund. */
export function lehneNachforderungAb(
  einsatzId: number,
  nachforderungId: number,
  grund?: string,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(`/api/einsaetze/${einsatzId}/nachforderungen/${nachforderungId}/ablehnen`, 'POST', { grund });
}
