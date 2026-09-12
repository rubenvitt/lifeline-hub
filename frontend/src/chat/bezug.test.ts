import { describe, expect, it } from 'vitest';
import { bezugLabel, type BezugOptionen } from './bezug';

const optionen: BezugOptionen = {
  schaden: [{ value: 3, label: 'S-003 · sachschaden · B5' }],
  uhs: [],
  person: [],
  lagebericht: [],
  meldung: [{ value: 7, label: '#7 · Leitstelle' }],
  auftrag: [],
};

describe('bezugLabel', () => {
  it('löst eine vorhandene Option zum Label auf', () => {
    expect(bezugLabel('schaden', 3, optionen)).toBe('S-003 · sachschaden · B5');
    expect(bezugLabel('meldung', 7, optionen)).toBe('#7 · Leitstelle');
  });

  it('fällt auf „{Typ} #{id}" zurück, wenn das Objekt nicht (mehr) in der Liste ist', () => {
    // z. B. storniertes/gefiltertes Objekt oder noch nicht geladene Liste.
    expect(bezugLabel('schaden', 99, optionen)).toBe('Schaden #99');
    expect(bezugLabel('person', 1, optionen)).toBe('Person #1');
    expect(bezugLabel('auftrag', 42, optionen)).toBe('Auftrag #42');
  });
});
