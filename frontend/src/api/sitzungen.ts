import type { SitzungAnzeige, SitzungenBeendet } from './types';
import { apiGet, apiSend } from './client';

/**
 * Sitzungsliste und Beenden ohne Deaktivieren (LFH-1092). Die eigenen Sitzungen unter
 * `/api/auth/sitzungen`, die einer Person für den Admin unter `/api/benutzer/{id}/sitzungen`.
 * Die aktuelle Sitzung endet nie über die Liste, nur über Abmelden (der Server antwortet 422).
 */
export function ladeEigeneSitzungen(): Promise<SitzungAnzeige[]> {
  return apiGet<SitzungAnzeige[]>('/api/auth/sitzungen');
}

export function beendeEigeneSitzung(kennung: string): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>(`/api/auth/sitzungen/${encodeURIComponent(kennung)}`, 'DELETE');
}

export function beendeAndereEigeneSitzungen(): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>('/api/auth/sitzungen/andere-beenden', 'POST');
}

export function ladeSitzungenVon(benutzerId: number): Promise<SitzungAnzeige[]> {
  return apiGet<SitzungAnzeige[]>(`/api/benutzer/${benutzerId}/sitzungen`);
}

export function beendeSitzungVon(benutzerId: number, kennung: string): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>(
    `/api/benutzer/${benutzerId}/sitzungen/${encodeURIComponent(kennung)}`,
    'DELETE',
  );
}

export function beendeAlleSitzungenVon(benutzerId: number): Promise<SitzungenBeendet> {
  return apiSend<SitzungenBeendet>(`/api/benutzer/${benutzerId}/sitzungen/beenden`, 'POST');
}
