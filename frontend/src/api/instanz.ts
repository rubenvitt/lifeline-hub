import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  ElwVerlorenAntwort,
  InstanzKopplungAnzeige,
  LetzterSchluesselHalter,
  InstanzUebersicht,
  KopplungscodeAntwort,
  StammdatenHerkunftAnzeige,
  UnterschriftAssertion,
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

/** „ELW verloren“ an der erreichten Seite (LLH-1493): Widerruf, Geheimnisse der dorthin verteilten
 *  Konten ungültig, Sitzungen beendet. */
export function meldeElwVerloren(id: number): Promise<ElwVerlorenAntwort> {
  return apiSend<ElwVerlorenAntwort>(`/api/admin/instanz/kopplungen/${id}/verloren`, 'POST');
}

/** „Erneut abgleichen“ an der meldenden Seite (LLH-1493): holt alle Stammdaten neu. */
export function gleicheStammdatenNeuAb(id: number): Promise<InstanzKopplungAnzeige> {
  return apiSend<InstanzKopplungAnzeige>(
    `/api/admin/instanz/kopplungen/${id}/stammdaten-neu`,
    'POST',
  );
}

/** Welche Stammdaten der eigenen Org vom Hub kommen (LLH-1493, design.md D9). */
export function loadStammdatenHerkunft(): Promise<StammdatenHerkunftAnzeige> {
  return apiGet<StammdatenHerkunftAnzeige>('/api/instanz/stammdaten/herkunft');
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

/** Was jede Unterschrift über eine Erklärung vom Server braucht (Start der Zeremonie). */
interface UnterschriftStart {
  zeremonie: string;
  challenge: string;
  rp_id: string;
  credential_ids: string[];
}

/**
 * Unterschreibt eine Erklärung, die der Server bildet (LLH-1490, Muster für LLH-1491): Start am
 * Server liefert die Challenge (Hash der Erklärung), der Browser unterschreibt sie mit einem
 * eigenen Unterschriftsschlüssel, der Abschluss reicht die Assertion durch. Der Browser bildet nie
 * selbst eine Challenge.
 */
export async function unterschreibeErklaerung<R>(
  startPfad: string,
  abschlussPfad: string,
  startBody?: unknown,
): Promise<R> {
  const start = await apiSend<UnterschriftStart>(startPfad, 'POST', startBody);
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
  return apiSend<R>(abschlussPfad, 'POST', { zeremonie: start.zeremonie, assertion });
}

/**
 * Zeichnet einen wartenden Schlüssel gegen: der Server bildet die Erklärung, der Browser
 * unterschreibt ihren Hash mit einem eigenen Unterschriftsschlüssel.
 */
export function gegenzeichne(id: number): Promise<UnterschriftSchluesselAnzeige> {
  return unterschreibeErklaerung<UnterschriftSchluesselAnzeige>(
    `/api/admin/instanz/unterschrift/${id}/gegenzeichnen/start`,
    `/api/admin/instanz/unterschrift/${id}/gegenzeichnen/abschluss`,
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

/**
 * Bestätigt einen vom Gegenüber nachgelieferten, wartenden Schlüssel (LLH-1605). `ende` sind die
 * letzten vier Zeichen des Fingerabdrucks, wie der Inhaber sie nennt; passen sie nicht, kommt 422.
 */
export function confirmUnterschriftsschluessel(
  id: number,
  ende: string,
): Promise<UnterschriftSchluesselAnzeige> {
  return apiSend<UnterschriftSchluesselAnzeige>(
    `/api/admin/instanz/unterschrift/${id}/bestaetigen`,
    'POST',
    { fingerabdruck_ende: ende },
  );
}

/** Weist einen vom Gegenüber nachgelieferten, wartenden Schlüssel zurück; er wird nie gültig. */
export function rejectUnterschriftsschluessel(id: number): Promise<UnterschriftSchluesselAnzeige> {
  return apiSend<UnterschriftSchluesselAnzeige>(
    `/api/admin/instanz/unterschrift/${id}/zurueckweisen`,
    'POST',
  );
}

/**
 * Konten, deren Deaktivieren oder Herabstufen die Kopplungen der Org ohne gültigen
 * Unterschriftsschlüssel zurückließe (LLH-1605); die Benutzerverwaltung warnt davor.
 */
export function loadLetzteSchluessel(): Promise<LetzterSchluesselHalter[]> {
  return apiGet<LetzterSchluesselHalter[]>('/api/admin/instanz/letzte-schluessel');
}
