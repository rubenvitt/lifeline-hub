import { apiGet, apiSend } from './client';
import type { LageMeldung, Meldung, MeldungStatus, NeueMeldung } from './types';

export interface MeldungFilter {
  status?: string;
}

export function listeMeldungen(einsatzId: number, filter: MeldungFilter = {}): Promise<Meldung[]> {
  const p = new URLSearchParams();
  if (filter.status) p.set('status', filter.status);
  const q = p.toString() ? `?${p.toString()}` : '';
  return apiGet<Meldung[]>(`/api/einsaetze/${einsatzId}/meldungen${q}`);
}

export function legeMeldungAn(einsatzId: number, daten: NeueMeldung): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen`, 'POST', daten);
}

/** Status setzen (sichten/in Bearbeitung/erledigt) + optional Bearbeiter zuweisen (LFH-94). */
export function setzeMeldungStatus(
  einsatzId: number,
  meldungId: number,
  status: MeldungStatus,
  bearbeiterId?: number | null,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/status`, 'POST', {
    status,
    bearbeiter_id: bearbeiterId ?? null,
  });
}

/** Als lagerelevant an die Lage übergeben (LFH-95). */
export function markiereLagerelevant(
  einsatzId: number,
  meldungId: number,
  text?: string,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/lagerelevant`, 'POST', { text });
}

/** Lageobjekte (aus lagerelevanten Meldungen) listen (LFH-95, Lage-Kategorie). */
export function listeLageMeldungen(einsatzId: number): Promise<LageMeldung[]> {
  return apiGet<LageMeldung[]>(`/api/einsaetze/${einsatzId}/lage/meldungen`);
}
