import { apiGet, apiSend } from './client';
import type { Auftrag, NeuerAuftrag } from './types';

export interface AuftragFilter {
  status?: string;
  richtung?: string;
  abschnittId?: number;
  einheitId?: number;
}

export function listeAuftraege(einsatzId: number, filter: AuftragFilter = {}): Promise<Auftrag[]> {
  const p = new URLSearchParams();
  if (filter.status) p.set('status', filter.status);
  if (filter.richtung) p.set('richtung', filter.richtung);
  if (filter.abschnittId != null) p.set('abschnitt_id', String(filter.abschnittId));
  if (filter.einheitId != null) p.set('einheit_id', String(filter.einheitId));
  const q = p.toString() ? `?${p.toString()}` : '';
  return apiGet<Auftrag[]>(`/api/einsaetze/${einsatzId}/auftraege${q}`);
}

export function legeAuftragAn(einsatzId: number, daten: NeuerAuftrag): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege`, 'POST', daten);
}

/** Quittierung pro Empfänger (LFH-90). */
export function quittiereEmpfaenger(einsatzId: number, auftragId: number, empfaengerId: number): Promise<Auftrag> {
  return apiSend<Auftrag>(
    `/api/einsaetze/${einsatzId}/auftraege/${auftragId}/empfaenger/${empfaengerId}/quittieren`,
    'POST',
  );
}

/** Vollzug setzen: in_arbeit oder vollzogen (mit Rückmeldetext) (LFH-91). */
export function setzeVollzug(
  einsatzId: number,
  auftragId: number,
  status: 'in_arbeit' | 'vollzogen',
  vollzugsmeldung?: string,
): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege/${auftragId}/vollzug`, 'POST', {
    status,
    vollzugsmeldung,
  });
}

/** Abnahme durch die Führung (LFH-91). */
export function nimmAb(einsatzId: number, auftragId: number): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege/${auftragId}/abnehmen`, 'POST');
}
