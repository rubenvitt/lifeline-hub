import { describe, expect, it } from 'vitest';
import {
  EINSATZFUNKTION_VORGABEN,
  einsatzfunktionVorschlaege,
  filterVorschlaege,
  funktionText,
  personLabel,
} from './einsatzfunktionKern';

describe('funktionText (LLH-1067, D2)', () => {
  it('nennt die Einsatzfunktion vor der Qualifikation', () => {
    expect(funktionText({ einsatzfunktion: 'Sprechfunker', funktion: 'Notfallsanitäter' })).toBe(
      'Sprechfunker',
    );
  });

  it('fällt ohne Einsatzfunktion auf die Qualifikation zurück', () => {
    expect(funktionText({ funktion: 'Notfallsanitäter' })).toBe('Notfallsanitäter');
    expect(funktionText({ einsatzfunktion: null, funktion: 'Notfallsanitäter' })).toBe(
      'Notfallsanitäter',
    );
    expect(funktionText({ einsatzfunktion: '  ', funktion: 'Notfallsanitäter' })).toBe(
      'Notfallsanitäter',
    );
  });

  it('liefert null, wenn beides fehlt', () => {
    expect(funktionText({})).toBeNull();
    expect(funktionText({ einsatzfunktion: '', funktion: '' })).toBeNull();
  });
});

describe('personLabel', () => {
  it('hängt die Funktion mit Mittelpunkt an, sonst nur der Name', () => {
    expect(personLabel({ name: 'Anna', einsatzfunktion: 'Melder', funktion: 'San' })).toBe(
      'Anna · Melder',
    );
    expect(personLabel({ name: 'Anna', funktion: 'San' })).toBe('Anna · San');
    expect(personLabel({ name: 'Anna' })).toBe('Anna');
  });
});

describe('einsatzfunktionVorschlaege (D1)', () => {
  it('nennt zuerst die im Einsatz vergebenen, dann die Vorgaben, dann die Qualifikationen', () => {
    const v = einsatzfunktionVorschlaege({
      vergeben: ['Lotse', null, undefined, ''],
      qualifikationen: ['Notfallsanitäter'],
    });
    expect(v[0]).toBe('Lotse');
    expect(v.slice(1, 1 + EINSATZFUNKTION_VORGABEN.length)).toEqual([...EINSATZFUNKTION_VORGABEN]);
    expect(v[v.length - 1]).toBe('Notfallsanitäter');
  });

  it('enthält die Vorgaben nach FwDV 3/100', () => {
    expect(EINSATZFUNKTION_VORGABEN).toEqual([
      'Einheitsführer',
      'Gruppenführer',
      'Truppführer',
      'Maschinist',
      'Melder',
      'Sprechfunker',
      'Fahrer',
    ]);
  });

  it('entdoppelt ohne Rücksicht auf Groß- und Kleinschreibung, das erste Vorkommen gewinnt', () => {
    const v = einsatzfunktionVorschlaege({
      vergeben: ['sprechfunker', 'Lotse', ' Lotse '],
      qualifikationen: ['Sprechfunker', 'Maschinist', 'Notarzt'],
    });
    expect(v.filter((s) => s.toLowerCase() === 'sprechfunker')).toEqual(['sprechfunker']);
    expect(v.filter((s) => s === 'Lotse')).toHaveLength(1);
    expect(v.filter((s) => s === 'Maschinist')).toHaveLength(1);
    expect(v).toContain('Notarzt');
  });

  it('sortiert die vergebenen alphabetisch', () => {
    const v = einsatzfunktionVorschlaege({
      vergeben: ['Zugtrupp', 'Atemschutz'],
      qualifikationen: [],
    });
    expect(v.slice(0, 2)).toEqual(['Atemschutz', 'Zugtrupp']);
  });
});

describe('filterVorschlaege', () => {
  const alle = ['Gruppenführer', 'Truppführer', 'Melder', 'Sprechfunker'];

  it('ohne Eingabe alle', () => {
    expect(filterVorschlaege(alle, '')).toEqual(alle);
    expect(filterVorschlaege(alle, '  ')).toEqual(alle);
  });

  it('trifft Teilwörter ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    expect(filterVorschlaege(alle, 'FÜHR')).toEqual(['Gruppenführer', 'Truppführer']);
  });

  it('lässt den genau eingegebenen Wert weg, er steht schon im Feld', () => {
    expect(filterVorschlaege(alle, 'melder')).toEqual([]);
  });
});
