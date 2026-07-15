import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { apiSend } from './client';

/**
 * Deckt `webauthn_rs::prelude::CreationChallengeResponse` ab (LFH-275, Task 5). Das Backend
 * serialisiert `PublicKeyCredentialCreationOptions` camelCase mit base64url-kodierten Feldern
 * (`challenge`/`user.id`/`excludeCredentials[].id`) — geprüft gegen `webauthn-rs-proto` 0.5.5
 * (`attest.rs`): das Shape deckt sich Feld-für-Feld mit `PublicKeyCredentialCreationOptionsJSON`
 * aus `@simplewebauthn/browser`, daher kein manuelles Base64url-Handling nötig.
 */
export interface WebauthnCreationChallenge {
  publicKey: PublicKeyCredentialCreationOptionsJSON;
}

/** Deckt `webauthn_rs::prelude::RequestChallengeResponse` ab (LFH-275, Task 6). Analog
 *  {@link WebauthnCreationChallenge} — Shape deckungsgleich mit
 *  `PublicKeyCredentialRequestOptionsJSON`. */
export interface WebauthnRequestChallenge {
  publicKey: PublicKeyCredentialRequestOptionsJSON;
}

/** POST /api/auth/webauthn/register/start — beginnt die Passkey-Registrierung für den
 *  angemeldeten Nutzer (`CurrentUser`-gegated serverseitig). Kein Body. Das Backend setzt dabei
 *  das kurzlebige, HttpOnly `webauthn_reg`-Cookie; der Browser schickt es bei
 *  `register/finish` automatisch mit (`credentials: 'same-origin'`, s. `client.ts`). */
export function webauthnRegistrierungStarten(): Promise<WebauthnCreationChallenge> {
  return apiSend<WebauthnCreationChallenge>('/api/auth/webauthn/register/start', 'POST');
}

/** POST /api/auth/webauthn/register/finish — Body ist das Ergebnis von
 *  `navigator.credentials.create` (hier: `startRegistration()` aus `@simplewebauthn/browser`).
 *  Antwort ist `201 Created` ohne Json-Body (s. `apiSend` in `client.ts`: leerer Body →
 *  `undefined`). */
export function webauthnRegistrierungAbschliessen(
  cred: RegistrationResponseJSON,
): Promise<void> {
  return apiSend<void>('/api/auth/webauthn/register/finish', 'POST', cred);
}

/** POST /api/auth/webauthn/auth/start — beginnt die passwortlose Passkey-Authentifizierung
 *  (öffentlich, PRE-Login). Setzt das kurzlebige, HttpOnly `webauthn_auth`-Cookie. */
export function webauthnAnmeldungStarten(
  benutzername: string,
): Promise<WebauthnRequestChallenge> {
  return apiSend<WebauthnRequestChallenge>('/api/auth/webauthn/auth/start', 'POST', {
    benutzername,
  });
}

/** POST /api/auth/webauthn/auth/finish — Body ist das Ergebnis von `navigator.credentials.get`
 *  (hier: `startAuthentication()` aus `@simplewebauthn/browser`). Bei `200 OK` ist die
 *  Session bereits per Cookie gesetzt (kein Json-Body, s. `apiSend`) — der Aufrufer muss den
 *  Benutzer danach selbst nachladen (`AuthContext.aktualisiere()`). */
export function webauthnAnmeldungAbschliessen(cred: AuthenticationResponseJSON): Promise<void> {
  return apiSend<void>('/api/auth/webauthn/auth/finish', 'POST', cred);
}
