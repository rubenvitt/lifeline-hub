import { describe, expect, it } from 'vitest';
import {
  ausschnitt,
  ausschnittLeer,
  ausschnittText,
  juengsterVermerk,
  vermerkFuer,
  vermerkKurz,
} from './feldVermerk';

describe('feldVermerk (LLH-1831/LLH-1834)', () => {
  it('vermerkKurz nennt Wer und Wann, ohne Namen nur die Zeit', () => {
    const zeit = (s: string) => `Z(${s})`;
    expect(vermerkKurz({ at: 'a', von: 'Anna' }, zeit)).toBe('Anna, Z(a)');
    expect(vermerkKurz({ at: 'a' }, zeit)).toBe('Z(a)');
  });

  it('juengsterVermerk nimmt den spätesten der genannten Felder', () => {
    const v = {
      name: { at: '2026-11-17 10:00:00', von: 'A' },
      bemerkung: { at: '2026-11-17 11:00:00', von: 'B' },
    };
    expect(juengsterVermerk(v, ['name', 'bemerkung'])?.von).toBe('B');
    expect(juengsterVermerk(v, ['name'])?.von).toBe('A');
    expect(juengsterVermerk(undefined, ['name'])).toBeUndefined();
  });

  it('ausschnitt nimmt genau die Schlüssel des Patches, fehlende als null', () => {
    const quelle = { einsatzort: 'A', einsatzort_lat: 1, einsatzort_lon: 2, sachverhalt: 'x' };
    expect(ausschnitt(quelle, { einsatzort: 'B' })).toEqual({ einsatzort: 'A' });
    expect(ausschnitt({}, { leitstellen_nr: 'B' })).toEqual({ leitstellen_nr: null });
  });

  it('ausschnittText und ausschnittLeer', () => {
    expect(ausschnittText({ einsatzort: 'Bahnhof', einsatzort_lat: 51.1 })).toBe('Bahnhof, 51.1');
    expect(ausschnittLeer({ a: null, b: '' })).toBe(true);
    expect(ausschnittLeer({ a: null, b: 'x' })).toBe(false);
  });

  it('vermerkFuer fasst Koordinaten und Soll-Stärke zu ihrer Angabe', () => {
    const v = {
      einsatzort_koordinate: { at: '2026-11-17 10:00:00', von: 'A' },
      soll: { at: '2026-11-17 09:00:00', von: 'S' },
    };
    expect(vermerkFuer(v, { einsatzort_lat: 1, einsatzort_lon: 2 })?.von).toBe('A');
    expect(vermerkFuer(v, { soll_fuehrer: 1, soll_mannschaft: 2 })?.von).toBe('S');
  });
});
