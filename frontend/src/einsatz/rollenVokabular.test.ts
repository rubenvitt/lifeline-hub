import { describe, expect, it } from 'vitest';
import {
  EINSATZ_ROLLE,
  KEINE_ROLLE,
  MODUL_STUFE,
  ORG_ROLLE,
  ROLLE_IM_EINSATZ_FELD,
  ROLLE_IN_ORG_FELD,
  ROLLE_IN_VERWALTUNG_FELD,
  SYSTEM_ADMIN_DER_ORG,
  SYSTEM_ROLLE,
  kontoRollenNamen,
  type RollenBegriff,
} from './rollenVokabular';

const ALLE: [string, Record<string, RollenBegriff>][] = [
  ['Rolle im Einsatz', EINSATZ_ROLLE],
  ['Rolle in der Organisation', ORG_ROLLE],
  ['Rolle in der Verwaltung', SYSTEM_ROLLE],
  ['Modulsperre', MODUL_STUFE],
];

describe('Rollen-Vokabular (LLH-1818)', () => {
  it.each(ALLE)('%s: jede Rolle hat Namen und eine kurze Darf-Zeile', (_, record) => {
    for (const begriff of Object.values(record)) {
      expect(begriff.name.trim()).not.toBe('');
      expect(begriff.darf.trim()).not.toBe('');
      // Anti-Ziel des Entwurfs: die Darf-Zeile wächst nicht zum Erklärsatz.
      expect(begriff.darf.length).toBeLessThanOrEqual(80);
    }
  });

  it('nennt jede Rolle mit genau einem Namen', () => {
    expect(EINSATZ_ROLLE.beobachter).toEqual({ name: 'Beobachter', darf: 'liest nur' });
    expect(EINSATZ_ROLLE.einsatzleitung.name).toBe('Einsatzleitung');
    expect(EINSATZ_ROLLE.fuehrungspersonal.name).toBe('Führungspersonal');
    expect(ORG_ROLLE.fuehrungskraft.name).toBe('Führungskraft der Organisation');
    expect(ORG_ROLLE.keine.name).toBe('Keine');
    expect(SYSTEM_ROLLE.admin.name).toBe('System-Admin');
    expect(SYSTEM_ROLLE.keiner.name).toBe('Keine');
    expect(MODUL_STUFE.frei.name).toBe('Frei (alle)');
    expect(MODUL_STUFE.einsatzfuehrung.name).toBe('Führung im Einsatz');
    expect(MODUL_STUFE.fuehrungskraft.name).toBe('Führungskraft der Organisation');
    expect(MODUL_STUFE.admin.name).toBe('System-Admin');
  });

  it('nennt die Felder nach dem Ort, an dem die Rolle gilt', () => {
    expect(ROLLE_IM_EINSATZ_FELD).toBe('Rolle im Einsatz');
    expect(ROLLE_IN_ORG_FELD).toBe('Rolle in der Organisation');
    expect(ROLLE_IN_VERWALTUNG_FELD).toBe('Rolle in der Verwaltung');
    expect(SYSTEM_ADMIN_DER_ORG).toBe('System-Admin der Organisation');
  });

  it('nennt die Rollen eines Kontos, System-Admin zuerst', () => {
    expect(kontoRollenNamen({ system_rolle: 'admin', org_rolle: 'fuehrungskraft' })).toEqual([
      'System-Admin',
      'Führungskraft der Organisation',
    ]);
    expect(kontoRollenNamen({ system_rolle: 'keiner', org_rolle: 'fuehrungskraft' })).toEqual([
      'Führungskraft der Organisation',
    ]);
    expect(kontoRollenNamen({ system_rolle: 'keiner', org_rolle: 'keine' })).toEqual([KEINE_ROLLE]);
    expect(KEINE_ROLLE).toBe('Keine Rolle');
  });
});
