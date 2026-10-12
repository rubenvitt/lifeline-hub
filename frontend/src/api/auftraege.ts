import { apiGet, apiSend, mitParametern } from './client';
import type { AbschlussCursor } from './meldungen';
import type {
  Auftrag,
  AuftragAufhebenBody,
  AuftragKennzahlen,
  AuftragPatch,
  NeuerAuftrag,
} from './types';

interface AuftragFilter {
  status?: string;
  richtung?: string;
  abschnittId?: number;
  einheitId?: number;
}

/** Vollliste ohne Phase (Überblick, Sprungpalette, Chat, Übernahme); das Board liest getrennt
 *  nach Phase. */
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

/** Seitengröße der abgeschlossenen Aufträge; der Server klemmt auf `[1, 500]` (LFH-1071). */
export const AUFTRAEGE_SEITE = 100;

/** Richtungs- und Empfängerfilter des Boards, ohne Status (LFH-1071). */
export type AuftragBoardFilter = Omit<AuftragFilter, 'status'>;

function boardParameter(filter: AuftragBoardFilter) {
  return {
    richtung: filter.richtung,
    abschnitt_id: filter.abschnittId,
    einheit_id: filter.einheitId,
  };
}

/** Cursor aus einem Auftrag: dieselbe Ordnungszeit wie am Server,
 *  `COALESCE(aufgehoben_at, abgenommen_at, vollzogen_at, erstellt_at)`. */
export function auftragAbschlussCursor(a: Auftrag): AbschlussCursor {
  return {
    zeit: a.aufgehoben_at ?? a.abgenommen_at ?? a.vollzogen_at ?? a.erstellt_at,
    id: a.id,
  };
}

/** Alle offenen und in Bearbeitung befindlichen Aufträge, ungeblättert (LFH-1071). */
export function listeOffeneAuftraege(
  einsatzId: number,
  filter: AuftragBoardFilter = {},
): Promise<Auftrag[]> {
  return apiGet<Auftrag[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/auftraege`, {
      phase: 'offen',
      ...boardParameter(filter),
    }),
  );
}

/** Eine Seite abgeschlossener Aufträge, zuletzt abgeschlossene zuerst (LFH-1071). */
export function listeAbgeschlosseneAuftraege(
  einsatzId: number,
  filter: AuftragBoardFilter = {},
  vor?: AbschlussCursor,
  limit: number = AUFTRAEGE_SEITE,
): Promise<Auftrag[]> {
  return apiGet<Auftrag[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/auftraege`, {
      phase: 'abgeschlossen',
      ...boardParameter(filter),
      vor_zeit: vor?.zeit,
      vor_id: vor?.id,
      limit,
    }),
  );
}

/** Zahl der offenen und abgeschlossenen Aufträge mit den Filtern des Boards (LFH-1071). */
export function ladeAuftragKennzahlen(
  einsatzId: number,
  filter: AuftragBoardFilter = {},
): Promise<AuftragKennzahlen> {
  return apiGet<AuftragKennzahlen>(
    mitParametern(`/api/einsaetze/${einsatzId}/auftraege/kennzahlen`, boardParameter(filter)),
  );
}

/** Ein Auftrag einzeln, etwa für einen Deeplink auf eine nicht geladene Seite (LFH-1071). */
export function ladeAuftrag(einsatzId: number, auftragId: number): Promise<Auftrag> {
  return apiGet<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege/${auftragId}`);
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

/** Hebt einen Auftrag mit Grund auf (LLH-1098); unumkehrbar, der Server schreibt das ETB. */
export function hebeAuf(einsatzId: number, auftragId: number, grund: string): Promise<Auftrag> {
  const body: AuftragAufhebenBody = { grund };
  return apiSend<Auftrag>(
    `/api/einsaetze/${einsatzId}/auftraege/${auftragId}/aufheben`,
    'POST',
    body,
  );
}

/** Berichtigt einen Auftrag vor der ersten Quittung (LLH-1098): nur die geänderten Felder. */
export function patcheAuftrag(
  einsatzId: number,
  auftragId: number,
  patch: AuftragPatch,
): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege/${auftragId}`, 'PATCH', patch);
}
