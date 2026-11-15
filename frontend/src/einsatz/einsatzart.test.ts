import { describe, expect, it } from 'vitest';
import { istUebung } from './einsatzart';

describe('istUebung (LLH-1725, Spec `uebungsmarke`)', () => {
  it('ist wahr genau bei der Einsatzart „Übung“', () => {
    expect(istUebung({ einsatzart: 'uebung' })).toBe(true);
  });

  it.each(['realeinsatz', 'sanitaetsdienst', 'bereitstellung'] as const)(
    'ist falsch bei %s',
    (einsatzart) => {
      expect(istUebung({ einsatzart })).toBe(false);
    },
  );

  it('ist falsch, solange der Einsatz fehlt oder lädt', () => {
    expect(istUebung(null)).toBe(false);
    expect(istUebung(undefined)).toBe(false);
  });

  it('ist falsch bei fehlender Art (eng typisierte Druckaufrufer)', () => {
    expect(istUebung({})).toBe(false);
    expect(istUebung({ einsatzart: null })).toBe(false);
  });
});
