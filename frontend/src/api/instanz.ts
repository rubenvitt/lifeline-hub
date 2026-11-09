import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  InstanzKopplungAnzeige,
  InstanzUebersicht,
  KopplungscodeAntwort,
  UnterschriftAssertion,
  UnterschriftGegenzeichnenStart,
  UnterschriftRegistrierenStart,
  UnterschriftSchluesselAnzeige,
} from './types';
import type { WebauthnCreationChallenge } from './webauthn';
import { apiGet, apiSend } from './client';

// Instanzkopplung (LLH-1490, Herleitung
// `openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md`):
// Verwaltung durch den Admin der Org. Die Routen, die eine andere Instanz ruft, kennt das Frontend nicht.

export function loadInstanzUebersicht(): Promise<InstanzUebersicht> {
  return apiGet<InstanzUebersicht>('/api/admin/instanz');
}

/** Stellt einen Kopplungscode aus; der Code steht nur in dieser Antwort. */
export function issueKopplungscode(): Promise<KopplungscodeAntwort> {
  return apiSend<KopplungscodeAntwort>('/api/admin/instanz/codes', 'POST');
}

/** Koppelt diese Instanz mit dem Code einer anderen unter `adresse`. */
export function redeemKopplungscode(
  adresse: string,
  code: string,
): Promise<InstanzKopplungAnzeige> {
  return apiSend<InstanzKopplungAnzeige>('/api/admin/instanz/einloesen', 'POST', {
    adresse,
    code,
  });
}

export function widerrufeKopplung(id: number): Promise<InstanzKopplungAnzeige> {
  return apiSend<InstanzKopplungAnzeige>(`/api/admin/instanz/kopplungen/${id}/widerrufen`, 'POST');
}

/**
 * Registriert einen Unterschriftsschlüssel: Start am Server, `navigator.credentials.create` im
 * Browser, Abschluss am Server. Der Passkey dient nur zum Unterschreiben, nie zur Anmeldung.
 */
export async function registriereUnterschriftsschluessel(
  bezeichnung: string,
): Promise<UnterschriftSchluesselAnzeige> {
  const start = await apiSend<UnterschriftRegistrierenStart>(
    '/api/admin/instanz/unterschrift/registrieren/start',
    'POST',
    { bezeichnung },
  );
  const optionen = start.optionen as unknown as WebauthnCreationChallenge;
  const antwort = await startRegistration({ optionsJSON: optionen.publicKey });
  return apiSend<UnterschriftSchluesselAnzeige>(
    '/api/admin/instanz/unterschrift/registrieren/abschluss',
    'POST',
    { zeremonie: start.zeremonie, antwort },
  );
}

/**
 * Zeichnet einen wartenden Schlüssel gegen: der Server bildet die Erklärung, der Browser
 * unterschreibt ihren Hash mit einem eigenen Unterschriftsschlüssel.
 */
export async function gegenzeichne(id: number): Promise<UnterschriftSchluesselAnzeige> {
  const start = await apiSend<UnterschriftGegenzeichnenStart>(
    `/api/admin/instanz/unterschrift/${id}/gegenzeichnen/start`,
    'POST',
  );
  const antwort = await startAuthentication({
    optionsJSON: {
      challenge: start.challenge,
      rpId: start.rp_id,
      allowCredentials: start.credential_ids.map((cid) => ({ id: cid, type: 'public-key' })),
      userVerification: 'required',
    },
  });
  const assertion: UnterschriftAssertion = {
    credential_id: antwort.id,
    authenticator_data: antwort.response.authenticatorData,
    client_data_json: antwort.response.clientDataJSON,
    signatur: antwort.response.signature,
  };
  return apiSend<UnterschriftSchluesselAnzeige>(
    `/api/admin/instanz/unterschrift/${id}/gegenzeichnen/abschluss`,
    'POST',
    { zeremonie: start.zeremonie, assertion },
  );
}

export function widerrufeUnterschriftsschluessel(
  id: number,
): Promise<UnterschriftSchluesselAnzeige> {
  return apiSend<UnterschriftSchluesselAnzeige>(
    `/api/admin/instanz/unterschrift/${id}/widerrufen`,
    'POST',
  );
}
