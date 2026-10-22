import { describe, expect, it } from 'vitest';
import { zahlText } from './zahl';

// LLH-1146: Dezimalzahlen der Anzeige deutsch — Komma, Tausenderpunkt, echtes Minus.
describe('zahlText', () => {
  it('setzt das Dezimalkomma mit fester Stellenzahl', () => {
    expect(zahlText(1.2, { stellen: 2 })).toBe('1,20');
    expect(zahlText(8, { stellen: 1 })).toBe('8,0');
    expect(zahlText(8.5, { stellen: 1 })).toBe('8,5');
  });

  it('rundet ohne Stellenangabe auf eine ganze Zahl', () => {
    expect(zahlText(7.6)).toBe('8');
  });

  it('gruppiert Tausender mit Punkt, auf Wunsch nicht', () => {
    expect(zahlText(12345.6, { stellen: 1 })).toBe('12.345,6');
    expect(zahlText(12345.6, { stellen: 1, gruppierung: false })).toBe('12345,6');
  });

  it('nimmt das echte Minuszeichen', () => {
    expect(zahlText(-3.5, { stellen: 1 })).toBe('−3,5');
  });
});
