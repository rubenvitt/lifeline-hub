import { describe, expect, it } from 'vitest';
import {
  AKTION_TEXT,
  ANMELDEWEG_TEXT,
  anmeldewegText,
  hasNamensziel,
  instanzText,
  rollenText,
} from './zugangsprotokollText';

/** Klartext des Zugangsprotokolls (LFH-1152): keine interne Kennung in der Liste. */
describe('anmeldewegText', () => {
  it.each([
    ['passwort', 'Passwort'],
    ['oidc', 'SSO'],
    ['webauthn', 'Passkey'],
    ['dev', 'Entwicklung'],
    ['totp', 'Zweiter Faktor'],
    ['geraetecode', 'Gerätecode'],
    ['systembrowser', 'Mac-App'],
    ['unbekannt', '—'],
  ])('%s → %s', (id, text) => {
    expect(anmeldewegText(id)).toBe(text);
  });

  it('kennt jeden Anmeldeweg des Servers', () => {
    expect(Object.keys(ANMELDEWEG_TEXT)).toHaveLength(8);
  });

  it('zeigt einen fremden Wert nicht roh', () => {
    expect(anmeldewegText('faxgeraet')).toBe('—');
  });
});

describe('rollenText', () => {
  it('nennt bei der Anlage beide Rollen wie der Benutzer-Dialog', () => {
    expect(rollenText({ system_rolle: 'keiner', org_rolle: 'keine' })).toBe(
      'System-Rolle: Benutzer, Org-Rolle: Keine',
    );
  });

  it('nennt beim Wechsel alt → neu, nur die geänderte Rolle', () => {
    expect(rollenText({ org_rolle_vorher: 'keine', org_rolle: 'fuehrungskraft' })).toBe(
      'Org-Rolle: Keine → Führungskraft',
    );
    expect(
      rollenText({
        system_rolle_vorher: 'keiner',
        system_rolle: 'admin',
        org_rolle_vorher: 'fuehrungskraft',
        org_rolle: 'keine',
      }),
    ).toBe('System-Rolle: Benutzer → Admin, Org-Rolle: Führungskraft → Keine');
  });

  it('ist leer ohne Rollen', () => {
    expect(rollenText({ geraet: 'iPad', angemeldet_at: '2026-10-10 12:13:34' })).toBeUndefined();
  });
});

describe('instanzText (LLH-1490)', () => {
  it('nennt Org, Fingerabdruck, Adresse und Grund', () => {
    expect(
      instanzText({
        fremde_org: 'DRK LV',
        fingerabdruck: 'ABCD-EFGH',
        adresse: 'https://hub.example.org',
        grund: 'ohne Gegenzeichnung',
      }),
    ).toBe(
      'Org dort: DRK LV · Fingerabdruck ABCD-EFGH · https://hub.example.org · Grund: ohne Gegenzeichnung',
    );
    expect(instanzText({})).toBeUndefined();
  });

  it('nennt gesperrte Konten und entfernte Passkeys (LLH-1493)', () => {
    expect(instanzText({ anzahl: 2 })).toBe('2 Konten gesperrt');
    expect(instanzText({ passkeys_entfernt: 1 })).toBe('1 Passkey entfernt');
    expect(instanzText({ passkeys_entfernt: 3 })).toBe('3 Passkeys entfernt');
  });
});

describe('Bestätigung nachgelieferter Schlüssel (LLH-1605)', () => {
  it('nennt Bestätigen und Zurückweisen und zeigt den Inhaber als Ziel', () => {
    expect(AKTION_TEXT.unterschrift_bestaetigt).toBe('Unterschriftsschlüssel bestätigt');
    expect(AKTION_TEXT.unterschrift_zurueckgewiesen).toBe('Unterschriftsschlüssel zurückgewiesen');
    expect(hasNamensziel('unterschrift_bestaetigt')).toBe(true);
    expect(hasNamensziel('unterschrift_zurueckgewiesen')).toBe(true);
  });
});

describe('Führung je Einsatz (LLH-1491)', () => {
  it('nennt die drei Aktionen und zeigt die Gegenstelle als Ziel', () => {
    expect(AKTION_TEXT.fuehrung_notuebernahme).toBe('Notübernahme der Führung');
    expect(AKTION_TEXT.fuehrung_verworfen).toBe('Ungültige Übernahme verworfen');
    expect(AKTION_TEXT.fuehrung_widerspruch).toBe('Notübernahme widersprochen');
    expect(hasNamensziel('fuehrung_notuebernahme')).toBe(true);
    expect(hasNamensziel('fuehrung_widerspruch')).toBe(true);
  });
});

describe('Archiv am Hub (LLH-1494)', () => {
  it('nennt Schlüssel und Abruf, zeigt die Bezeichnung als Ziel und den Block', () => {
    expect(AKTION_TEXT.archiv_schluessel_eingetragen).toBe('Archiv-Schlüssel eingetragen');
    expect(AKTION_TEXT.archiv_heruntergeladen).toBe('Archiv heruntergeladen');
    expect(hasNamensziel('archiv_schluessel_geprueft')).toBe(true);
    expect(hasNamensziel('archiv_heruntergeladen')).toBe(true);
    expect(instanzText({ fingerabdruck: 'ab12:cd34', block: 2 })).toBe(
      'Fingerabdruck ab12:cd34 · Block 2',
    );
  });
});
