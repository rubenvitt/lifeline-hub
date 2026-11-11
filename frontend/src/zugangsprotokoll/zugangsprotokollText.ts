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
  einmalpasswort_vergeben: 'Einmalpasswort vergeben',
  lesezugang_angelegt: 'Lagemonitor-Zugang angelegt',
  lesezugang_widerrufen: 'Lagemonitor-Zugang widerrufen',
  instanz_code_ausgestellt: 'Kopplungscode ausgestellt',
  instanz_code_eingeloest: 'Kopplungscode eingelöst',
  instanz_gekoppelt: 'Instanz gekoppelt',
  instanz_kopplung_widerrufen: 'Instanzkopplung widerrufen',
  instanz_kopplung_vom_gegenueber_widerrufen: 'Instanzkopplung vom Gegenüber widerrufen',
  unterschrift_registriert: 'Unterschriftsschlüssel registriert',
  unterschrift_gegengezeichnet: 'Unterschriftsschlüssel gegengezeichnet',
  unterschrift_widerrufen: 'Unterschriftsschlüssel widerrufen',
  unterschrift_abgelehnt: 'Unterschriftsschlüssel abgelehnt',
  unterschrift_bestaetigt: 'Unterschriftsschlüssel bestätigt',
  unterschrift_zurueckgewiesen: 'Unterschriftsschlüssel zurückgewiesen',
  instanz_elw_verloren: 'ELW als verloren gemeldet',
  fuehrung_notuebernahme: 'Notübernahme der Führung',
  fuehrung_verworfen: 'Ungültige Übernahme verworfen',
  fuehrung_widerspruch: 'Notübernahme widersprochen',
};

/**
 * Aktionen, deren Ziel ein Name ist und kein Anmeldeweg: Lagemonitor-Zugang (LLH-1484, die
 * Bezeichnung), Instanzkopplung und Unterschriftsschlüssel (LLH-1490, Instanz bzw. Inhaber),
 * Führung je Einsatz (LLH-1491, die Gegenstelle).
 */
export function hasNamensziel(aktion: AdminAktion): boolean {
  return (
    aktion === 'lesezugang_angelegt' ||
    aktion === 'lesezugang_widerrufen' ||
    aktion.startsWith('instanz_') ||
    aktion.startsWith('unterschrift_') ||
    aktion.startsWith('fuehrung_')
  );
}

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

/**
 * Angaben der Instanzkopplung und der Unterschriftsschlüssel (LLH-1490): Gegenstelle mit Org,
 * Fingerabdruck, Adresse, bei `unterschrift_abgelehnt` der Grund, bei `instanz_elw_verloren` die
 * Zahl der Konten und beim Einmalpasswort für einen Admin unter Passkey-Pflicht die entfernten
 * Passkeys. `undefined`, wenn keine dieser Angaben steht.
 */
export function instanzText(a: ZugangsAngaben): string | undefined {
  const teile = [
    a.fremde_org ? `Org dort: ${a.fremde_org}` : null,
    a.fingerabdruck ? `Fingerabdruck ${a.fingerabdruck}` : null,
    a.adresse ?? null,
    a.grund ? `Grund: ${a.grund}` : null,
    // „ELW verloren“ (LLH-1493): Konten, deren Passwort und zweiter Faktor ungültig wurden.
    a.anzahl != null ? `${a.anzahl} ${a.anzahl === 1 ? 'Konto' : 'Konten'} gesperrt` : null,
    // Einmalpasswort unter Passkey-Pflicht oder Notfallbefehl (LLH-1493).
    a.passkeys_entfernt != null
      ? `${a.passkeys_entfernt} ${a.passkeys_entfernt === 1 ? 'Passkey' : 'Passkeys'} entfernt`
      : null,
  ].filter((t): t is string => t != null);
  return teile.length > 0 ? teile.join(' · ') : undefined;
}

export function istEreignis(wert: string | null): wert is AnmeldeEreignis {
  return wert != null && Object.prototype.hasOwnProperty.call(EREIGNIS_TEXT, wert);
}

export function istAktion(wert: string | null): wert is AdminAktion {
  return wert != null && Object.prototype.hasOwnProperty.call(AKTION_TEXT, wert);
}
