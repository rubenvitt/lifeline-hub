import { describe, expect, it } from 'vitest';
import {
  einsatzRechteGrund,
  NUR_ADMIN,
  NUR_LEITUNG_FUEHRUNG_ORG_ADMIN,
  NUR_LEITUNG_ORG_ADMIN,
} from './nurAnsicht';

describe('nurAnsicht (LFH-1078)', () => {
  it('nennt beim abgeschlossenen Einsatz den Abschluss, sonst die Rolle', () => {
    expect(einsatzRechteGrund('abgeschlossen')).toBe('Einsatz abgeschlossen');
    expect(einsatzRechteGrund('aktiv')).toBe('nur Einsatzleitung und Führungspersonal');
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
