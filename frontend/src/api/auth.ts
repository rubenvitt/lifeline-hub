import type { BenutzerAnzeige } from './types';
import { apiGet, apiSend } from './client';

export function login(benutzername: string, passwort: string): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>('/api/auth/login', 'POST', { benutzername, passwort });
}

export function logout(): Promise<void> {
  return apiSend<void>('/api/auth/logout', 'POST');
}

export function me(): Promise<BenutzerAnzeige> {
  return apiGet<BenutzerAnzeige>('/api/auth/me');
}
