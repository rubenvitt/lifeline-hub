import { describe, expect, it } from 'vitest';
import { dichten, schriftskala, type Dichte } from '../theme/tokens';
import { menueSpaltenBreite } from './menueSpalte';

const STUFEN: Dichte[] = ['kompakt', 'komfortabel', 'handschuh'];

describe('menueSpaltenBreite', () => {
  it('fasst den Kopf „Aktionen“ in der Augenbraue in jeder Dichte (LLH-2083)', () => {
    // Der Kopf steht in der Augenbraue (11 px, fest in jeder Dichte); „AKTIONEN“ misst gesperrt
    // rund 65 px. Sechs Augenbrauen-Größen lassen Luft für den Schriftsatz der CI.
    for (const d of STUFEN) {
      const inhalt = menueSpaltenBreite(d) - 2 * dichten[d].abstand.md;
      expect(inhalt, d).toBeGreaterThanOrEqual(6 * schriftskala.augenbraue.groesse);
    }
  });

  it('trägt den quadratischen Menüauslöser der Dichte', () => {
    for (const d of STUFEN) {
      const inhalt = menueSpaltenBreite(d) - 2 * dichten[d].abstand.md;
      expect(inhalt, d).toBeGreaterThanOrEqual(dichten[d].zeilenhoehe);
    }
  });

  it('wächst nur, wo der Kopf es braucht: komfortabel und handschuh bleiben', () => {
    expect(menueSpaltenBreite('komfortabel')).toBe(106);
    expect(menueSpaltenBreite('handschuh')).toBe(120);
  });
});
