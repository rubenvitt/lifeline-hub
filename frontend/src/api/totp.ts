import type { BenutzerAnzeige, TotpEnrollFinish, TotpEnrollStart } from './types';
import { apiSend } from './client';

/** POST /api/auth/totp/enroll/start (LFH-43, Task 4): beginnt (oder erneuert) ein
 *  TOTP-Enrollment für den angemeldeten Nutzer (`CurrentUser`-gegated serverseitig, kein
 *  gesonderter Auth-Header nötig — `apiSend` schickt Cookies same-origin). Liefert das frische,
 *  noch NICHT aktive Secret: `otpauth_url` für den QR-Code-Scan, `secret_base32` als
 *  Klartext-Fallback zum manuellen Eintragen in die Authenticator-App. */
export function enrollStart(): Promise<TotpEnrollStart> {
  return apiSend<TotpEnrollStart>('/api/auth/totp/enroll/start', 'POST');
}

/** POST /api/auth/totp/enroll/finish (LFH-43, Task 4): bestätigt das laufende Enrollment mit
 *  einem gültigen TOTP-Code und aktiviert MFA. Liefert die frischen Recovery-Codes im KLARTEXT —
 *  NUR HIER, EINMALIG (ab dem nächsten Request existieren nur noch ihre sha256-Hashes
 *  serverseitig) — der Aufrufer MUSS sie dem Nutzer eindringlich anzeigen (s. `ProfilPage`). */
export function enrollFinish(code: string): Promise<TotpEnrollFinish> {
  return apiSend<TotpEnrollFinish>('/api/auth/totp/enroll/finish', 'POST', { code });
}

/** POST /api/auth/totp/finish (LFH-43, Task 5): zweiter Schritt des Passwort→TOTP-Logins
 *  (öffentlich, PRE-Session — kein `CurrentUser` nötig). Body ist ein TOTP- ODER Recovery-Code:
 *  dasselbe Feld/Endpoint, der Server unterscheidet nicht zwischen beiden. Die Identität kommt
 *  ausschließlich aus dem `mfa_pending`-Cookie, das `POST /api/auth/login` zuvor gesetzt hat —
 *  dieser Aufruf trägt weder Benutzername noch Passwort. Bei Erfolg steht die Session bereits
 *  per Cookie; der Aufrufer lädt den Benutzer trotzdem über `AuthContext.aktualisiere()` nach
 *  (analog dem Passkey-Pfad, LFH-275) statt sich auf dieses Rückgabeobjekt zu verlassen. */
export function totpFinish(code: string): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>('/api/auth/totp/finish', 'POST', { code });
}
