import { apiGet, apiSend } from './client';
import type { BenachrichtigungArt, IosPushStand } from './types';

/**
 * iOS-Push (Spec `ios-push`, `src/routes/ios_push.rs`). Ohne `--ios-push` am Server antworten alle
 * Routen mit 404, ein Gerätekonto mit 403. Die Anmeldung hängt an Konto und Gerät (`kennung`) und an
 * der Sitzung, die sie zuletzt gemeldet hat (`an_dieser_sitzung`).
 */

/** Kennung, nach der der Server fragt, wenn das Gerät noch nie angemeldet war: nirgends bekannt. */
const KEINE_KENNUNG = '00000000-0000-0000-0000-000000000000';

/** Stand für dieses Gerät; ohne `kennung` (nie registriert) ist es nicht angemeldet. */
export function ladeIosPushStand(kennung?: string): Promise<IosPushStand> {
  const abfrage = new URLSearchParams({ kennung: kennung ?? KEINE_KENNUNG });
  return apiGet<IosPushStand>(`/api/ios-push?${abfrage.toString()}`);
}

/** Anmeldung dieses Geräts; kein Backend-Schema (der Server liest sie nur). */
export interface IosPushAnmeldungEingabe {
  /** Zufällige UUID, die die App selbst erzeugt und behält (`registration_id` der Hülle). */
  kennung: string;
  /** Geräte-Token von APNs, Hex. */
  token: string;
  umgebung: 'sandbox' | 'production';
  /** 32 Byte als Base64url: der Schlüssel der Nutzlast. */
  schluessel: string;
  /** „Mit Absender und Wortlaut“; fehlt es, gilt aus. */
  inhalt?: boolean;
  /** „Stumm auf diesem Gerät“: für diese Arten schickt der Server keinen Push. */
  stumm?: BenachrichtigungArt[];
}

/** Meldet dieses Gerät für den angemeldeten Nutzer an; dieselbe Kennung ersetzt die Anmeldung. */
export function meldeIosPushAn(e: IosPushAnmeldungEingabe): Promise<void> {
  return apiSend<void>('/api/ios-push/anmeldung', 'PUT', e);
}

/** Meldet die Anmeldung dieses Geräts ab; idempotent. */
export function meldeIosPushAb(kennung: string): Promise<void> {
  return apiSend<void>('/api/ios-push/anmeldung', 'DELETE', { kennung });
}
