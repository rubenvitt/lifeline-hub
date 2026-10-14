import { describe, expect, it } from 'vitest';
import { POSITION_KUERZEL, POSITION_LABELS, POSITION_OPTIONEN } from './personal';

describe('Stärke-Position (LFH-4, LLH-1060)', () => {
  it('führt die Kürzel F, UF und M an einer Stelle neben den Wörtern', () => {
    expect(POSITION_KUERZEL).toEqual({ fuehrer: 'F', unterfuehrer: 'UF', mannschaft: 'M' });
    expect(Object.keys(POSITION_KUERZEL)).toEqual(Object.keys(POSITION_LABELS));
  });

  it('bietet die Auswahl in der Folge Führer, Unterführer, Mannschaft', () => {
    expect(POSITION_OPTIONEN.map((o) => o.label)).toEqual(['Führer', 'Unterführer', 'Mannschaft']);
  });
});
