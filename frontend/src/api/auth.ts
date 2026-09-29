import type { AuthProvider, BenutzerAnzeige } from './types';
import { apiGet, apiSend } from './client';

/** Schmale Antwort auf `POST /api/auth/login`, wenn TOTP als zweiter Faktor aktiv ist: KEIN
 *  Benutzer, KEINE Session; der Server setzt ein HttpOnly `mfa_pending`-Cookie, weiter geht es
 *  über `totpFinish()` (`api/totp.ts`). Serverseitig `#[serde(untagged)]` und bewusst nicht im
 *  Typ-Codegen: die Nicht-TOTP-Form bleibt byte-identisch `BenutzerAnzeige`. */
export interface MfaErforderlich {
  mfa_erforderlich: string;
}

export function login(
  benutzername: string,
  passwort: string,
): Promise<BenutzerAnzeige | MfaErforderlich> {
  return apiSend<BenutzerAnzeige | MfaErforderlich>('/api/auth/login', 'POST', {
    benutzername,
    passwort,
  });
}

export function logout(): Promise<void> {
  return apiSend<void>('/api/auth/logout', 'POST');
}

export function me(): Promise<BenutzerAnzeige> {
  return apiGet<BenutzerAnzeige>('/api/auth/me');
}

/** Lädt die aktiven Auth-Provider für die Login-UI (serverseitig auf `aktiviert==true`
 *  gefiltert). Die volle Liste für die Verwaltung liefert {@link providerListeAdmin}. */
export function providerListe(): Promise<AuthProvider[]> {
  return apiGet<AuthProvider[]>('/api/auth/providers');
}

/** Lädt die VOLLE Provider-Liste inkl. deaktivierter (Admin). Serverseitig
 *  `AdminUser`-geschützt; `401`/`403` als {@link ApiError}. */
export function providerListeAdmin(): Promise<AuthProvider[]> {
  return apiGet<AuthProvider[]>('/api/auth/providers/admin');
}

/** Schaltet einen Auth-Provider an/aus (Admin) und gibt die aktualisierte Liste zurück. `404`
 *  (unbekannt) und `409` (Lockout: letzter admin-tauglicher Login-Weg) kommen als
 *  {@link ApiError}. */
export function providerSchalten(id: string, aktiviert: boolean): Promise<AuthProvider[]> {
  return apiSend<AuthProvider[]>(`/api/auth/providers/${id}`, 'PUT', { aktiviert });
}
