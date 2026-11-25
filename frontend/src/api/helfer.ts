import type {
  HelferAnzeige,
  HelferEinladungAnzeige,
  HelferUebersicht,
  HelferZielArt,
} from './types';
import { apiGet, apiSend } from './client';

// Helfer-App, Seite der Einsatzleitung (Spec
// `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Oberfläche“): Einladung,
// Bestätigen, Ablehnen, Abmelden. Der Server lässt nur die Einsatzleitung zu.

const basis = (einsatzId: number) => `/api/incidents/${einsatzId}/helpers`;

/** `reason` des 409 beim Bestätigen: das Ziel hat schon ein Ortungsgerät (`holder` = dessen Kopplung). */
export const GRUND_TRACKER_TAKEN = 'tracker_taken';

/** `reason` des 422 beim Bestätigen: Person zugeordnet, obwohl die Kraft keine Personenortung wollte. */
export const GRUND_PERSON_NOT_REQUESTED = 'person_not_requested';

/** Gültige Einladung (ohne Code) und alle Helfer des Einsatzes. */
export function loadHelfer(einsatzId: number): Promise<HelferUebersicht> {
  return apiGet<HelferUebersicht>(basis(einsatzId));
}

/** Neue Einladung; ersetzt eine gültige alte. Der Code steht nur in dieser Antwort. 403: Ortung aus. */
export function createHelferEinladung(
  einsatzId: number,
  validMinutes: number,
): Promise<HelferEinladungAnzeige> {
  return apiSend<HelferEinladungAnzeige>(`${basis(einsatzId)}/invitations`, 'POST', {
    valid_minutes: validMinutes,
  });
}

/** Widerruft die Einladung; angemeldete Helfer bleiben. */
export function revokeHelferEinladung(einsatzId: number, einladungId: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/invitations/${einladungId}/revoke`, 'POST');
}

export interface HelferBestaetigungBody {
  /** Korrigiertes Ziel; fehlt es, bleibt das gewählte. */
  target?: { kind: HelferZielArt; id: number };
  person_id?: number | null;
  is_tracker: boolean;
  /** Das bisherige Ortungsgerät des Ziels gibt die Rolle ab. */
  replace?: boolean;
}

/** Bestätigt einen wartenden Helfer oder ändert einen angemeldeten. 409 `tracker_taken` mit `holder`. */
export function confirmHelfer(
  einsatzId: number,
  kopplungId: number,
  body: HelferBestaetigungBody,
): Promise<HelferAnzeige> {
  return apiSend<HelferAnzeige>(`${basis(einsatzId)}/${kopplungId}/confirm`, 'POST', body);
}

/** Lehnt einen wartenden Helfer ab. */
export function rejectHelfer(einsatzId: number, kopplungId: number): Promise<HelferAnzeige> {
  return apiSend<HelferAnzeige>(`${basis(einsatzId)}/${kopplungId}/reject`, 'POST');
}

/** Meldet einen Helfer ab; die Position einer zugeordneten Person fällt weg. */
export function removeHelfer(einsatzId: number, kopplungId: number): Promise<HelferAnzeige> {
  return apiSend<HelferAnzeige>(`${basis(einsatzId)}/${kopplungId}/revoke`, 'POST');
}

/** Meldet alle laufenden Helfer ab; liefert die Übersicht. */
export function removeAllHelfer(einsatzId: number): Promise<HelferUebersicht> {
  return apiSend<HelferUebersicht>(`${basis(einsatzId)}/revoke`, 'POST');
}

/** Neues Ende eines angemeldeten Helfers (UTC ohne Zone, `alsBackendZeit`), höchstens 72 h. */
export function extendHelfer(
  einsatzId: number,
  kopplungId: number,
  laeuftAbAt: string,
): Promise<HelferAnzeige> {
  return apiSend<HelferAnzeige>(`${basis(einsatzId)}/${kopplungId}/extend`, 'POST', {
    laeuft_ab_at: laeuftAbAt,
  });
}
