import { apiGet, apiSend, mitParametern } from './client';
import type {
  KommunikationsStelle,
  NeueKommunikationsStelle,
  NeueVerbindung,
  VerbindungPatch,
} from './types';

/**
 * Kommunikationsplan des S6 (LFH-848): gepflegte Stellen mit ihren Verbindungen, in
 * Anzeigereihenfolge vom Server. Jede Schreibantwort ist der ganze Plan nach dem Commit; der
 * Aufrufer setzt ihn per `setQueryData` (design.md D3).
 */
function basis(einsatzId: number): string {
  return `/api/einsaetze/${einsatzId}/stab/kommunikationsplan`;
}

export function ladeKommunikationsplan(einsatzId: number): Promise<KommunikationsStelle[]> {
  return apiGet<KommunikationsStelle[]>(basis(einsatzId));
}

export function legeKommunikationsStelleAn(
  einsatzId: number,
  daten: NeueKommunikationsStelle,
): Promise<KommunikationsStelle[]> {
  return apiSend<KommunikationsStelle[]>(`${basis(einsatzId)}/stellen`, 'POST', daten);
}

/**
 * Legt eine Stelle an und antwortet mit GENAU dieser Stelle statt mit dem Plan
 * (`?antwort=stelle`, LFH-893 Review S4): die Fernmeldeskizze nimmt das Anlegen per Rückgängig
 * zurück und braucht dafür die id, die der Plan allein nicht eindeutig nennt.
 */
export function legeKommunikationsStelleEinzelnAn(
  einsatzId: number,
  daten: NeueKommunikationsStelle,
): Promise<KommunikationsStelle> {
  return apiSend<KommunikationsStelle>(
    mitParametern(`${basis(einsatzId)}/stellen`, { antwort: 'stelle' }),
    'POST',
    daten,
  );
}

/** Nur die Bezeichnung; Stellenart und Funktion sind nach dem Anlegen fest. */
export function benenneKommunikationsStelleUm(
  einsatzId: number,
  stelleId: number,
  bezeichnung: string,
): Promise<KommunikationsStelle[]> {
  return apiSend<KommunikationsStelle[]>(`${basis(einsatzId)}/stellen/${stelleId}`, 'PATCH', {
    bezeichnung,
  });
}

/** Entfernt die Stelle samt ihren Verbindungen. */
export function entferneKommunikationsStelle(
  einsatzId: number,
  stelleId: number,
): Promise<KommunikationsStelle[]> {
  return apiSend<KommunikationsStelle[]>(`${basis(einsatzId)}/stellen/${stelleId}`, 'DELETE');
}

export function legeVerbindungAn(
  einsatzId: number,
  stelleId: number,
  daten: NeueVerbindung,
): Promise<KommunikationsStelle[]> {
  return apiSend<KommunikationsStelle[]>(
    `${basis(einsatzId)}/stellen/${stelleId}/verbindungen`,
    'POST',
    daten,
  );
}

export function aendereVerbindung(
  einsatzId: number,
  verbindungId: number,
  daten: VerbindungPatch,
): Promise<KommunikationsStelle[]> {
  return apiSend<KommunikationsStelle[]>(
    `${basis(einsatzId)}/verbindungen/${verbindungId}`,
    'PATCH',
    daten,
  );
}

export function entferneVerbindung(
  einsatzId: number,
  verbindungId: number,
): Promise<KommunikationsStelle[]> {
  return apiSend<KommunikationsStelle[]>(
    `${basis(einsatzId)}/verbindungen/${verbindungId}`,
    'DELETE',
  );
}
