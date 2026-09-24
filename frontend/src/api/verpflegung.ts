import { apiGet, apiSend } from './client';
import type {
  AusgabeEingabe,
  Verpflegung,
  VerpflegungAusgabeErgebnis,
  VerpflegungZeitfenster,
  ZeitfensterEingabe,
  ZeitfensterPatch,
} from './types';

/**
 * Verpflegung (LFH-634): Zeitfenster mit erfasstem Bedarf und Ausgaben an Essensportionen.
 * Deckung und Fehlmenge rechnet der Server (design.md D2); die zeitabhängige Einstufung
 * rechnet `verpflegung/deckung.ts` im Client. Zeiten am Draht: UTC ohne Zonenkennung.
 */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/verpflegung`;

/** Alle Zeitfenster des Einsatzes, nach Beginn geordnet (Ordnung vom Server). */
export function ladeVerpflegung(einsatzId: number): Promise<Verpflegung> {
  return apiGet<Verpflegung>(basis(einsatzId));
}

export function legeZeitfensterAn(
  einsatzId: number,
  body: ZeitfensterEingabe,
): Promise<VerpflegungZeitfenster> {
  return apiSend<VerpflegungZeitfenster>(`${basis(einsatzId)}/zeitfenster`, 'POST', body);
}

/** Teiländerung; geprüft wird serverseitig gegen den Effektivzustand (Bestand + Patch). */
export function aendereZeitfenster(
  einsatzId: number,
  zeitfensterId: number,
  body: ZeitfensterPatch,
): Promise<VerpflegungZeitfenster> {
  return apiSend<VerpflegungZeitfenster>(
    `${basis(einsatzId)}/zeitfenster/${zeitfensterId}`,
    'PATCH',
    body,
  );
}

/** 422, solange eine gültige (nicht zurückgenommene) Ausgabe existiert. */
export function loescheZeitfenster(einsatzId: number, zeitfensterId: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/zeitfenster/${zeitfensterId}`, 'DELETE');
}

/** Antwort trägt die neue Ausgabe-ID und das Zeitfenster mit nachgerechneter Deckung. */
export function erfasseAusgabe(
  einsatzId: number,
  zeitfensterId: number,
  body: AusgabeEingabe,
): Promise<VerpflegungAusgabeErgebnis> {
  return apiSend<VerpflegungAusgabeErgebnis>(
    `${basis(einsatzId)}/zeitfenster/${zeitfensterId}/ausgaben`,
    'POST',
    body,
  );
}

/** Weiche Rücknahme; die Ausgabe bleibt mit `zurueckgenommen_at` stehen. 422 beim zweiten Mal. */
export function nimmAusgabeZurueck(
  einsatzId: number,
  ausgabeId: number,
): Promise<VerpflegungAusgabeErgebnis> {
  return apiSend<VerpflegungAusgabeErgebnis>(
    `${basis(einsatzId)}/ausgaben/${ausgabeId}/zuruecknehmen`,
    'POST',
    {},
  );
}
