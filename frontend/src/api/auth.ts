import type { AuthProvider, BenutzerAnzeige } from './types';
import { apiGet, apiSend } from './client';

/** Schmale Antwort auf `POST /api/auth/login`, wenn der Nutzer TOTP als zweiten Faktor
 *  aktiviert hat (LFH-43, Increment 5): KEIN Benutzer, KEINE Session — stattdessen setzt der
 *  Server ein HttpOnly `mfa_pending`-Cookie, und der Login-Flow wird über `totpFinish()`
 *  (`api/totp.ts`) fortgesetzt. Serverseitig `#[serde(untagged)]` (`LoginAntwort` in
 *  `routes/auth.rs`) — bewusst NICHT im Typ-Codegen registriert (Backend-Kommentar: die
 *  Nicht-TOTP-Form bleibt byte-identisch `BenutzerAnzeige`, diese Union ist Frontend-lokal
 *  handgepflegt, s. CLAUDE.md „Backend↔Frontend-Typ-Codegen"). */
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

/** Lädt die aktiven Auth-Provider für die Login-UI (LFH-57). Serverseitig auf `aktiviert==true`
 *  gefiltert (LFH-277) — deaktivierte Provider sind dem unauthentifizierten Login-UI nicht
 *  sichtbar. Für die Admin-Provider-Verwaltung (volle Liste inkl. deaktivierter) siehe
 *  {@link providerListeAdmin}. */
export function providerListe(): Promise<AuthProvider[]> {
  return apiGet<AuthProvider[]>('/api/auth/providers');
}

/** Lädt die VOLLE Provider-Liste inkl. deaktivierter (Admin-Provider-Verwaltung, LFH-277/LFH-280).
 *  Serverseitig `AdminUser`-geschützt; `401`/`403` als {@link ApiError}. */
export function providerListeAdmin(): Promise<AuthProvider[]> {
  return apiGet<AuthProvider[]>('/api/auth/providers/admin');
}

/** Schaltet einen Auth-Provider an/aus (Admin, LFH-280). Gibt die aktualisierte Server-Liste
 *  zurück. `404` (unbekannt) und `409` (Lockout — letzter admin-tauglicher Login-Weg) kommen
 *  als {@link ApiError}; die Fehlermeldung ist serverseitig lesbar formuliert. */
export function providerSchalten(id: string, aktiviert: boolean): Promise<AuthProvider[]> {
  return apiSend<AuthProvider[]>(`/api/auth/providers/${id}`, 'PUT', { aktiviert });
}
