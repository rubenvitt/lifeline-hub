import { describe, expect, it } from 'vitest';
import {
  einsatzRechteGrund,
  MODUL_PERSONAL_GESPERRT,
  MODULE_PERSONAL_FAHRZEUGE_GESPERRT,
  modulSperre,
  NUR_ADMIN,
  NUR_LEITUNG_FUEHRUNG_ORG_ADMIN,
  NUR_LEITUNG_ORG_ADMIN,
} from './nurAnsicht';

describe('nurAnsicht (LFH-1078)', () => {
  it('nennt beim abgeschlossenen Einsatz den Abschluss, sonst die Rolle', () => {
    expect(einsatzRechteGrund('abgeschlossen')).toBe('Einsatz abgeschlossen');
    expect(einsatzRechteGrund('aktiv')).toBe('nur Einsatzleitung und Führungspersonal');
  });

  it('nennt am Spiegel die führende Instanz, auch im abgeschlossenen Einsatz (LLH-1492)', () => {
    const spiegel = {
      gegenstelle: 'ELW 1',
      beendet: false,
      antraege_ausstehend: 0,
      antraege_abgelehnt: 0,
      bruchstelle: 0,
    };
    expect(einsatzRechteGrund({ status: 'aktiv', spiegel })).toBe('Spiegel von ELW 1');
    expect(einsatzRechteGrund({ status: 'abgeschlossen', spiegel })).toBe('Spiegel von ELW 1');
    expect(einsatzRechteGrund({ status: 'aktiv', spiegel: null })).toBe(
      'nur Einsatzleitung und Führungspersonal',
    );
  });

  it('bleibt bei wenigen Wörtern', () => {
    for (const grund of [
      einsatzRechteGrund('abgeschlossen'),
      einsatzRechteGrund('aktiv'),
      NUR_ADMIN,
      NUR_LEITUNG_FUEHRUNG_ORG_ADMIN,
      NUR_LEITUNG_ORG_ADMIN,
    ])
      expect(grund.split(' ').length).toBeLessThanOrEqual(5);
  });
});

describe('modulSperre (LLH-1462)', () => {
  it('nennt ein, zwei und drei Module im Wortlaut der Konstanten', () => {
    expect(modulSperre([])).toBeNull();
    expect(modulSperre(['Personal'])).toBe(MODUL_PERSONAL_GESPERRT);
    expect(modulSperre(['Personal', 'Fahrzeuge'])).toBe(MODULE_PERSONAL_FAHRZEUGE_GESPERRT);
    expect(modulSperre(['Einheiten', 'Personal', 'Fahrzeuge'])).toBe(
      'Module Einheiten, Personal und Fahrzeuge gesperrt',
    );
  });
});
