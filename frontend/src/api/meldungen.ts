import { apiGet, apiSend } from './client';
import type { LageMeldung, Meldung, MeldungStatus, NeueMeldung } from './types';

export interface MeldungFilter {
  status?: string;
  richtung?: string;
}

export function listeMeldungen(einsatzId: number, filter: MeldungFilter = {}): Promise<Meldung[]> {
  const p = new URLSearchParams();
  if (filter.status) p.set('status', filter.status);
  if (filter.richtung) p.set('richtung', filter.richtung);
  const q = p.toString() ? `?${p.toString()}` : '';
  return apiGet<Meldung[]>(`/api/einsaetze/${einsatzId}/meldungen${q}`);
}

export function legeMeldungAn(einsatzId: number, daten: NeueMeldung): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen`, 'POST', daten);
}

/** Triage-Status setzen (sichten/in Bearbeitung/erledigt) (LFH-94). */
export function setzeMeldungStatus(
  einsatzId: number,
  meldungId: number,
  status: MeldungStatus,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/status`, 'POST', {
    status,
  });
}

/** Bearbeiter zuweisen (Mitglied-id) oder freigeben (null) (LFH-94). */
export function weiseBearbeiterZu(
  einsatzId: number,
  meldungId: number,
  bearbeiterId: number | null,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/zuweisen`, 'POST', {
    bearbeiter_id: bearbeiterId,
  });
}

/** Sofortmeldung aktiv bestätigen (Quittung mit Zeitstempel + Person) (LFH-97). */
export function bestaetigeMeldung(einsatzId: number, meldungId: number): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/bestaetigen`, 'POST', {});
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
