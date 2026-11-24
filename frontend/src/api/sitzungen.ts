import type { SitzungAnzeige, SitzungenBeendet } from './types';
import { apiGet, apiSend } from './client';

/**
 * Sitzungsliste und Beenden ohne Deaktivieren (LFH-1092). Die eigenen Sitzungen unter
 * `/api/auth/sessions`, die einer Person für den Admin unter `/api/users/{id}/sessions`.
 * Die aktuelle Sitzung endet nie über die Liste, nur über Abmelden (der Server antwortet 422).
 */
export function ladeEigeneSitzungen(): Promise<SitzungAnzeige[]> {
  return apiGet<SitzungAnzeige[]>('/api/auth/sessions');
}

export function beendeEigeneSitzung(kennung: string): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>(`/api/auth/sessions/${encodeURIComponent(kennung)}`, 'DELETE');
}

export function beendeAndereEigeneSitzungen(): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>('/api/auth/sessions/end-others', 'POST');
}

export function ladeSitzungenVon(benutzerId: number): Promise<SitzungAnzeige[]> {
  return apiGet<SitzungAnzeige[]>(`/api/users/${benutzerId}/sessions`);
}

export function beendeSitzungVon(benutzerId: number, kennung: string): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>(
    `/api/users/${benutzerId}/sessions/${encodeURIComponent(kennung)}`,
    'DELETE',
  );
}

export function beendeAlleSitzungenVon(benutzerId: number): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>(`/api/users/${benutzerId}/sessions/end`, 'POST');
}
