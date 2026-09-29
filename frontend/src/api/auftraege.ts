import { apiGet, apiSend, mitParametern } from './client';
import type { Auftrag, NeuerAuftrag } from './types';

export interface AuftragFilter {
  status?: string;
  richtung?: string;
  abschnittId?: number;
  einheitId?: number;
}

export function listeAuftraege(einsatzId: number, filter: AuftragFilter = {}): Promise<Auftrag[]> {
  return apiGet<Auftrag[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/auftraege`, {
      status: filter.status,
      richtung: filter.richtung,
      abschnitt_id: filter.abschnittId,
      einheit_id: filter.einheitId,
    }),
  );
}

export function legeAuftragAn(einsatzId: number, daten: NeuerAuftrag): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege`, 'POST', daten);
}

/** Quittierung pro Empfänger (LFH-90). */
export function quittiereEmpfaenger(
  einsatzId: number,
  auftragId: number,
  empfaengerId: number,
): Promise<Auftrag> {
  return apiSend<Auftrag>(
    `/api/einsaetze/${einsatzId}/auftraege/${auftragId}/empfaenger/${empfaengerId}/quittieren`,
    'POST',
  );
}

/** Vollzug setzen: in_arbeit oder vollzogen (mit Rückmeldetext) (LFH-91). */
export function setzeVollzug(
  einsatzId: number,
  auftragId: number,
  /** `'offen'` ist die Rücknahme von „In Bearbeitung“ und nur von dort aus erlaubt; aus
   *  `vollzogen` antwortet der Server mit 422. */
  status: 'offen' | 'in_arbeit' | 'vollzogen',
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
