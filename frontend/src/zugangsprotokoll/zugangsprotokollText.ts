import type { AdminAktion, AnmeldeEreignis } from '../api/types';

/**
 * Wortlaut des Zugangsprotokolls (LFH-1097). Exhaustive `Record`s: ein neuer Wert im Backend
 * bricht hier den Typecheck, statt still als Rohwert zu erscheinen. Ereignis und Aktion sind
 * Kategorien, kein Status: sie stehen als Wort, ohne Farbe (`frontend/AGENTS.md`, Farbachsen).
 */

export const EREIGNIS_TEXT: Record<AnmeldeEreignis, string> = {
  login_ok: 'Anmeldung',
  login_fehlgeschlagen: 'Anmeldung fehlgeschlagen',
  logout: 'Abmeldung',
  passwort_geaendert: 'Passwort geändert',
  passwort_wechsel_abgewiesen: 'Passwortwechsel abgewiesen',
  sitzung_beendet: 'Sitzung beendet',
};

export const AKTION_TEXT: Record<AdminAktion, string> = {
  benutzer_angelegt: 'Konto angelegt',
  benutzer_deaktiviert: 'Konto deaktiviert',
  benutzer_reaktiviert: 'Konto reaktiviert',
  rolle_geaendert: 'Rolle geändert',
  zweitfaktor_zurueckgesetzt: 'Zweitfaktor zurückgesetzt',
  anmeldeweg_aktiviert: 'Anmeldeweg aktiviert',
  anmeldeweg_deaktiviert: 'Anmeldeweg deaktiviert',
  sitzung_beendet: 'Sitzung beendet',
  einmalpasswort_vergeben: 'Einmalpasswort vergeben',
};

/** Anmeldewege nach ihrer id (`auth::provider::ID_*`); Unbekanntes steht als id. */
const ANMELDEWEG_TEXT: Readonly<Record<string, string>> = {
  passwort: 'Passwort',
  oidc: 'SSO',
  webauthn: 'Passkey',
  dev: 'Entwicklung',
};

export function anmeldewegText(id: string): string {
  return ANMELDEWEG_TEXT[id] ?? id;
}

export function istEreignis(wert: string | null): wert is AnmeldeEreignis {
  return wert != null && Object.prototype.hasOwnProperty.call(EREIGNIS_TEXT, wert);
}

export function istAktion(wert: string | null): wert is AdminAktion {
  return wert != null && Object.prototype.hasOwnProperty.call(AKTION_TEXT, wert);
}
