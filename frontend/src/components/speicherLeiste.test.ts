import { describe, expect, it } from 'vitest';
import { dichten } from '../theme/tokens';
import { speicherLeisteStil } from './speicherLeiste';

const token = { colorBgContainer: '#fff', paddingSM: 8, padding: 11, colorBorderSecondary: '#ccc' };

describe('speicherLeisteStil', () => {
  it('bleibt für die Leiste mit EINEM Knopf, wie sie war', () => {
    const stil = speicherLeisteStil(token);
    expect(stil).toMatchObject({ position: 'sticky', bottom: 0, paddingBlock: 8 });
    // Die elf bisherigen Nutzer tragen genau „Speichern“: kein Reihenlayout, kein Abstand.
    expect(stil.display).toBeUndefined();
    expect(stil.gap).toBeUndefined();
  });

  it('mit „Abbrechen“: Reihe mit Abstand `padding`, wie der Fuß der Erfassungs-Hülle', () => {
    const stil = speicherLeisteStil(token, { hasAbbrechen: true });
    // Mutationsprobe: `gap: token.paddingSM` (7 px in `kompakt`) macht den Test rot.
    expect(stil).toMatchObject({
      position: 'sticky',
      display: 'flex',
      flexWrap: 'wrap',
      gap: token.padding,
    });
  });

  it('der Abstand hält die Leitlinie ≥ 8 px (Maus) bzw. ≥ 16 px (Touch) in jeder Stufe', () => {
    // `token.padding` ist `abstand.md` der Stufe (`theme/tokens.ts`, `antdToken`).
    expect(dichten.kompakt.abstand.md).toBeGreaterThanOrEqual(8);
    expect(dichten.komfortabel.abstand.md).toBeGreaterThanOrEqual(16);
    expect(dichten.handschuh.abstand.md).toBeGreaterThanOrEqual(16);
  });
});
