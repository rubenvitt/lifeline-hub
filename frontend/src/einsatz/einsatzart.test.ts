import { describe, expect, it } from 'vitest';
import { isUebung } from './einsatzart';

describe('isUebung (LLH-1725, Spec `uebungsmarke`)', () => {
  it('ist wahr genau bei der Einsatzart „Übung“', () => {
    expect(isUebung({ einsatzart: 'uebung' })).toBe(true);
  });

  it.each(['realeinsatz', 'sanitaetsdienst', 'bereitstellung'] as const)(
    'ist falsch bei %s',
    (einsatzart) => {
      expect(isUebung({ einsatzart })).toBe(false);
    },
  );

  it('ist falsch, solange der Einsatz fehlt oder lädt', () => {
    expect(isUebung(null)).toBe(false);
    expect(isUebung(undefined)).toBe(false);
  });

  it('ist falsch bei fehlender Art (eng typisierte Druckaufrufer)', () => {
    expect(isUebung({})).toBe(false);
    expect(isUebung({ einsatzart: null })).toBe(false);
  });
});
