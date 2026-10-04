import type { BenutzerAnzeige, TotpEnrollFinish, TotpEnrollStart } from './types';
import { apiSend } from './client';

/** POST /api/auth/totp/enroll/start: beginnt ein TOTP-Enrollment für den angemeldeten Nutzer
 *  (oder ein noch nicht bestätigtes neu). Liefert das frische, noch NICHT aktive Secret:
 *  `otpauth_url` für den QR-Code, `secret_base32` als Klartext-Fallback. Bei aktivem TOTP 422
 *  (LFH-794). */
export function enrollStart(): Promise<TotpEnrollStart> {
  return apiSend<TotpEnrollStart>('/api/auth/totp/enroll/start', 'POST');
}

/** POST /api/auth/totp/enroll/finish: bestätigt das Enrollment mit einem gültigen Code und
 *  aktiviert MFA. Liefert die Recovery-Codes im KLARTEXT, NUR HIER und EINMALIG (danach liegen
 *  serverseitig nur Hashes); der Aufrufer MUSS sie dem Nutzer eindringlich anzeigen. */
export function enrollFinish(code: string): Promise<TotpEnrollFinish> {
  return apiSend<TotpEnrollFinish>('/api/auth/totp/enroll/finish', 'POST', { code });
}

/** POST /api/auth/totp/finish: zweiter Schritt des Passwort→TOTP-Logins (öffentlich, vor der
 *  Session). Body ist ein TOTP- ODER Recovery-Code, dasselbe Feld. Die Identität kommt allein aus
 *  dem `mfa_pending`-Cookie von `POST /api/auth/login`. Bei Erfolg steht die Session per Cookie;
 *  der Aufrufer lädt den Benutzer über `AuthContext.aktualisiere()` nach. */
export function totpFinish(code: string): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>('/api/auth/totp/finish', 'POST', { code });
}
