import type { AdminAktion, AnmeldeEreignis, Anmeldeweg, ZugangsAngaben } from '../api/types';
import {
  ORG_ROLLE_FELD,
  ORG_ROLLE_TEXT,
  SYSTEM_ROLLE_FELD,
  SYSTEM_ROLLE_TEXT,
} from '../stammdaten/rechteText';

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
};

/**
 * Anmeldewege nach ihrer id (`auth::provider::Anmeldeweg`, LFH-1152). Exhaustiv wie Ereignis und
 * Aktion: ein neuer Weg im Backend bricht hier den Typecheck. `unbekannt` trägt eine Abmeldung
 * aus einer Sitzung, die sich ihren Weg nicht gemerkt hat.
 */
export const ANMELDEWEG_TEXT: Record<Anmeldeweg, string> = {
  passwort: 'Passwort',
  oidc: 'SSO',
  webauthn: 'Passkey',
  dev: 'Entwicklung',
  totp: 'Zweiter Faktor',
  geraetecode: 'Gerätecode',
  systembrowser: 'Mac-App',
  unbekannt: '—',
};

/** Klartext eines Anmeldewegs; auch das Ziel der Admin-Spur ist eine solche id. Fremdes: „—“. */
export function anmeldewegText(id: string): string {
  return Object.prototype.hasOwnProperty.call(ANMELDEWEG_TEXT, id)
    ? ANMELDEWEG_TEXT[id as Anmeldeweg]
    : ANMELDEWEG_TEXT.unbekannt;
}

/**
 * Rollen der Angaben einer Zugangsänderung (LFH-1152), beschriftet wie der Benutzer-Dialog:
 * „System-Rolle: Benutzer, Org-Rolle: Keine“ bei der Anlage, „Org-Rolle: Keine → Führungskraft“
 * beim Wechsel. `undefined`, wenn die Angaben keine Rolle tragen.
 */
export function rollenText(a: ZugangsAngaben): string | undefined {
  const teile: string[] = [];
  const rolle = <R extends string>(
    feld: string,
    text: Record<R, string>,
    vorher: R | null | undefined,
    nachher: R | null | undefined,
  ) => {
    if (nachher == null) return;
    teile.push(`${feld}: ${vorher == null ? '' : `${text[vorher]} → `}${text[nachher]}`);
  };
  rolle(SYSTEM_ROLLE_FELD, SYSTEM_ROLLE_TEXT, a.system_rolle_vorher, a.system_rolle);
  rolle(ORG_ROLLE_FELD, ORG_ROLLE_TEXT, a.org_rolle_vorher, a.org_rolle);
  return teile.length > 0 ? teile.join(', ') : undefined;
}

export function istEreignis(wert: string | null): wert is AnmeldeEreignis {
  return wert != null && Object.prototype.hasOwnProperty.call(EREIGNIS_TEXT, wert);
}

export function istAktion(wert: string | null): wert is AdminAktion {
  return wert != null && Object.prototype.hasOwnProperty.call(AKTION_TEXT, wert);
}
