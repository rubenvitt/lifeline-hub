import { apiGet, apiSend, type ApiSendOptionen } from './client';
import type {
  AusgabeEingabe,
  TagAusVorlageEingabe,
  Verpflegung,
  VerpflegungTagErgebnis,
  VerpflegungAusgabeErgebnis,
  Verpflegungsstelle,
  VerpflegungsstelleEingabe,
  VerpflegungsstellePatch,
  VerpflegungsstelleStatus,
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

/** Alle Zeitfenster des Einsatzes, nach Beginn geordnet (Ordnung vom Server), und die
 *  Verpflegungsstellen nach Bezeichnung (LLH-1040, keine eigene Leseroute). */
export function ladeVerpflegung(einsatzId: number): Promise<Verpflegung> {
  return apiGet<Verpflegung>(basis(einsatzId));
}

export function legeZeitfensterAn(
  einsatzId: number,
  body: ZeitfensterEingabe,
): Promise<VerpflegungZeitfenster> {
  return apiSend<VerpflegungZeitfenster>(`${basis(einsatzId)}/zeitfenster`, 'POST', body);
}

/**
 * Tag aus der Vorlage (LLH-1058): legt die Zeitfenster eines Tages in einer Transaktion an. 201,
 * wenn mindestens eins entsteht; 200, wenn jedes übersprungen wird (gleichnamig am Tag schon da).
 */
export function createTagAusVorlage(
  einsatzId: number,
  body: TagAusVorlageEingabe,
): Promise<VerpflegungTagErgebnis> {
  return apiSend<VerpflegungTagErgebnis>(
    `${basis(einsatzId)}/zeitfenster/aus-vorlage`,
    'POST',
    body,
  );
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

/**
 * Antwort trägt die neue Ausgabe-ID und das Zeitfenster mit nachgerechneter Deckung. Mit
 * `client_id` ist der Aufruf idempotent (LFH-688): ein Replay liefert die gespeicherte Ausgabe.
 */
export function erfasseAusgabe(
  einsatzId: number,
  zeitfensterId: number,
  body: AusgabeEingabe,
  optionen?: ApiSendOptionen,
): Promise<VerpflegungAusgabeErgebnis> {
  return apiSend<VerpflegungAusgabeErgebnis>(
    `${basis(einsatzId)}/zeitfenster/${zeitfensterId}/ausgaben`,
    'POST',
    body,
    optionen,
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

// ── Verpflegungsstellen (LLH-1040) ──────────────────────────────────────────────────────────

/** Legt eine Stelle `geplant` an; 409, wenn die Bezeichnung schon vergeben ist. */
export function createStelle(
  einsatzId: number,
  body: VerpflegungsstelleEingabe,
): Promise<Verpflegungsstelle> {
  return apiSend<Verpflegungsstelle>(`${basis(einsatzId)}/stellen`, 'POST', body);
}

/** Teiländerung, auch einer aufgelösten Stelle; 409 bei einer stornierten. */
export function updateStelle(
  einsatzId: number,
  stelleId: number,
  body: VerpflegungsstellePatch,
): Promise<Verpflegungsstelle> {
  return apiSend<Verpflegungsstelle>(`${basis(einsatzId)}/stellen/${stelleId}`, 'PATCH', body);
}

/** In Betrieb nehmen (`aktiv`) oder auflösen (`aufgeloest`); 422 bei unzulässigem Übergang. */
export function setStelleStatus(
  einsatzId: number,
  stelleId: number,
  status: VerpflegungsstelleStatus,
): Promise<Verpflegungsstelle> {
  return apiSend<Verpflegungsstelle>(`${basis(einsatzId)}/stellen/${stelleId}/status`, 'POST', {
    status,
  });
}

/** Storno einer geplanten Stelle ohne Ausgabe; sonst 422. */
export function storniereStelle(einsatzId: number, stelleId: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/stellen/${stelleId}`, 'DELETE');
}
