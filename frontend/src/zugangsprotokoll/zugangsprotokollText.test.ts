import { describe, expect, it } from 'vitest';
import {
  AKTION_TEXT,
  ANMELDEWEG_TEXT,
  anmeldewegText,
  fristText,
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
    ['systembrowser', 'Lifeline-App'],
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
      'Rolle in der Verwaltung: Keine, Rolle in der Organisation: Keine',
    );
  });

  it('nennt beim Wechsel alt → neu, nur die geänderte Rolle', () => {
    expect(rollenText({ org_rolle_vorher: 'keine', org_rolle: 'fuehrungskraft' })).toBe(
      'Rolle in der Organisation: Keine → Führungskraft der Organisation',
    );
    expect(
      rollenText({
        system_rolle_vorher: 'keiner',
        system_rolle: 'admin',
        org_rolle_vorher: 'fuehrungskraft',
        org_rolle: 'keine',
      }),
    ).toBe(
      'Rolle in der Verwaltung: Keine → System-Admin, Rolle in der Organisation: Führungskraft der Organisation → Keine',
    );
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
    expect(AKTION_TEXT.archiv_eingespielt).toBe('Archiv eingespielt');
    expect(hasNamensziel('archiv_eingespielt')).toBe(true);
    // LLH-1712: Löschersuchen für eine Person im Archiv und die Suche danach, per Befehl.
    expect(AKTION_TEXT.archiv_person_geschwaerzt).toBe('Person im Archiv geschwärzt');
    expect(AKTION_TEXT.archiv_durchsucht).toBe('Archiv durchsucht');
    expect(hasNamensziel('archiv_person_geschwaerzt')).toBe(true);
    expect(instanzText({ fingerabdruck: 'ab12:cd34', block: 2 })).toBe(
      'Fingerabdruck ab12:cd34 · Block 2',
    );
  });
});

describe('Webhook einer Anbindung (LLH-1656)', () => {
  it('nennt die Aktionen, trägt den Namen der Anbindung als Ziel und zeigt nur den Host', () => {
    expect(AKTION_TEXT.maschinenzugang_webhook_angelegt).toBe('Webhook eingerichtet');
    expect(AKTION_TEXT.maschinenzugang_webhook_lan_erlaubt).toBe(
      'Webhook: Ziel im lokalen Netz erlaubt',
    );
    expect(hasNamensziel('maschinenzugang_webhook_angelegt')).toBe(true);
    expect(instanzText({ zugang_id: 'z1', host: 'empfaenger.example' })).toBe(
      'Ziel: empfaenger.example',
    );
  });
});

describe('Fingerabdruck am Webhook (LLH-1872)', () => {
  it('nennt Hinterlegen, Entfernen und Abrufen und zeigt Host und Fingerabdruck', () => {
    expect(AKTION_TEXT.maschinenzugang_webhook_pin_gesetzt).toBe(
      'Webhook: Fingerabdruck hinterlegt',
    );
    expect(AKTION_TEXT.maschinenzugang_webhook_pin_entfernt).toBe(
      'Webhook: Fingerabdruck entfernt',
    );
    expect(AKTION_TEXT.maschinenzugang_webhook_zertifikat_abgerufen).toBe(
      'Webhook: Zertifikat vom Ziel abgerufen',
    );
    expect(hasNamensziel('maschinenzugang_webhook_pin_gesetzt')).toBe(true);
    const text = instanzText({
      zugang_id: 'z1',
      host: 'elw.lan',
      fingerabdruck: 'ab12',
      fingerabdruck_vorher: 'cd34',
    });
    expect(text).toContain('elw.lan');
    expect(text).toContain('ab12');
    expect(text).toContain('cd34');
  });
});

describe('Adapter (LLH-2017)', () => {
  it('nennt die Aktionen, trägt den Namen des Adapters als Ziel und zeigt Art, Platz und Host', () => {
    expect(AKTION_TEXT.adapter_geheimnis_gesetzt).toBe('Geheimnis eines Adapters gesetzt');
    expect(AKTION_TEXT.adapter_lan_erlaubt).toBe('Adapter: Ziel im lokalen Netz erlaubt');
    expect(hasNamensziel('adapter_angelegt')).toBe(true);
    expect(
      instanzText({
        adapter_id: 'a1',
        adapter_art: 'divera',
        platz: 'accesskey',
        host: 'app.divera247.com',
      }),
    ).toBe('Art: divera · Geheimnis: accesskey · Ziel: app.divera247.com');
  });
});

describe('Einwurf-Zugang (LLH-1654)', () => {
  it('nennt die drei Aktionen und zeigt den Namen des Zugangs als Ziel', () => {
    expect(AKTION_TEXT.einwurf_zugang_angelegt).toBe('Einwurf-Zugang angelegt');
    expect(AKTION_TEXT.einwurf_zugang_schluessel_gewechselt).toBe(
      'Schlüssel eines Einwurf-Zugangs gewechselt',
    );
    expect(AKTION_TEXT.einwurf_zugang_widerrufen).toBe('Einwurf-Zugang widerrufen');
    expect(hasNamensziel('einwurf_zugang_angelegt')).toBe(true);
    expect(hasNamensziel('einwurf_zugang_schluessel_gewechselt')).toBe(true);
    expect(hasNamensziel('einwurf_zugang_widerrufen')).toBe(true);
    // Auch die Anbindung trägt ihren Namen als Ziel (LLH-1652).
    expect(hasNamensziel('maschinenzugang_angelegt')).toBe(true);
  });
});

describe('Angaben einer Anbindung (LLH-1652)', () => {
  it('nennt Rechte vorher → nachher und den abgelösten Schlüssel', () => {
    expect(
      instanzText({
        scopes: ['lage:read', 'events:read'],
        scopes_vorher: ['lage:read'],
        fingerabdruck: 'NEU1',
        fingerabdruck_vorher: 'ALT1',
      }),
    ).toBe(
      'Fingerabdruck NEU1 · vorher ALT1 · Rechte: Lage lesen → Lage lesen, Ereignisse abrufen',
    );
  });
});

describe('Ortung im Einsatz (LLH-2120)', () => {
  it('benennt jeden Wechsel der beiden Org-Schalter', () => {
    expect(AKTION_TEXT.ortung_eingeschaltet).toBe('Ortung im Einsatz eingeschaltet');
    expect(AKTION_TEXT.ortung_ausgeschaltet).toBe('Ortung im Einsatz ausgeschaltet');
    expect(AKTION_TEXT.ortung_personen_eingeschaltet).toBe('Ortung von Personen eingeschaltet');
    expect(AKTION_TEXT.ortung_personen_ausgeschaltet).toBe('Ortung von Personen ausgeschaltet');
  });

  it('hat kein Namensziel (das Ziel ist der Schalter selbst)', () => {
    expect(hasNamensziel('ortung_eingeschaltet')).toBe(false);
    expect(hasNamensziel('ortung_personen_ausgeschaltet')).toBe(false);
  });
});

describe('Fristen der Org (LLH-2140)', () => {
  it('benennt die drei Fristen wie das Formular „Einsatz-Vorgaben“', () => {
    expect(AKTION_TEXT.aufbewahrung_frist_geaendert).toBe('Aufbewahrungs-Dauer geändert');
    expect(AKTION_TEXT.skelett_frist_geaendert).toBe('Skelett-Frist geändert');
    expect(AKTION_TEXT.nachbereitung_frist_geaendert).toBe('Nachbereitung geändert');
  });

  it('hat kein Namensziel', () => {
    expect(hasNamensziel('skelett_frist_geaendert')).toBe(false);
  });

  it.each([
    [{ tage: 365 }, 'keine → 365 Tage'],
    [{ tage_vorher: 3650, tage: 365 }, '3650 → 365 Tage'],
    [{ tage_vorher: 365 }, '365 Tage → keine'],
    [{ tage_vorher: 2, tage: 1 }, '2 → 1 Tag'],
    [{ tage: 1 }, 'keine → 1 Tag'],
  ])('zeigt den Wechsel %j als „%s“', (angaben, text) => {
    expect(fristText(angaben)).toBe(text);
  });

  it('gibt ohne Tage nichts zurück (andere Aktionen, alte Einträge)', () => {
    expect(fristText({})).toBeUndefined();
    expect(fristText({ fingerabdruck: 'AB' })).toBeUndefined();
  });
});
