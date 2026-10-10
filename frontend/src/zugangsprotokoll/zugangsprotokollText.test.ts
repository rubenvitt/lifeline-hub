import { describe, expect, it } from 'vitest';
import { ANMELDEWEG_TEXT, anmeldewegText, rollenText } from './zugangsprotokollText';

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
