import { describe, expect, it } from 'vitest';
import type { SchichtplanGrenzwerte } from '../api/types';
import {
  grenzwerteBody,
  grenzwerteFormWerte,
  grenzwerteZeile,
  grenzwertText,
  MAX_DIENST_VORGABE_MINUTEN,
  MIN_RUHE_VORGABE_MINUTEN,
  rueckgaengigBody,
  vorgabenBody,
} from './grenzwerte';

const vorgaben: SchichtplanGrenzwerte = {
  max_dienst_minuten: MAX_DIENST_VORGABE_MINUTEN,
  min_ruhe_minuten: MIN_RUHE_VORGABE_MINUTEN,
  max_dienst_eigen: false,
  min_ruhe_eigen: false,
};
const eigene: SchichtplanGrenzwerte = {
  max_dienst_minuten: 600,
  min_ruhe_minuten: 450,
  max_dienst_eigen: true,
  min_ruhe_eigen: true,
};

describe('grenzwertText (LLH-1603)', () => {
  it('kennzeichnet die Vorgabe und lässt einen eigenen Wert ohne Zusatz', () => {
    expect(grenzwertText(720, false)).toBe('12 h (Vorgabe)');
    expect(grenzwertText(600, true)).toBe('10 h');
    expect(grenzwertText(450, true)).toBe('7:30 h');
  });

  it('zeigt eine Mindestruhe von 0 als „0 min“, nie leer', () => {
    expect(grenzwertText(0, true)).toBe('0 min');
  });

  it('folgt dem Merker des Servers, nicht dem Wert: 12 h als eigener Wert ohne „(Vorgabe)“', () => {
    expect(grenzwertText(720, true)).toBe('12 h');
  });
});

describe('grenzwerteZeile (LLH-1603)', () => {
  it('nennt beide Werte für den Schichtplan', () => {
    expect(grenzwerteZeile(vorgaben)).toBe(
      'Höchstdienst 12 h (Vorgabe) · Mindestruhe 8 h (Vorgabe)',
    );
    expect(grenzwerteZeile({ ...vorgaben, max_dienst_minuten: 600, max_dienst_eigen: true })).toBe(
      'Höchstdienst 10 h · Mindestruhe 8 h (Vorgabe)',
    );
  });
});

describe('grenzwerteFormWerte (LLH-1603)', () => {
  it('lässt ein Feld leer, solange die Vorgabe gilt', () => {
    expect(grenzwerteFormWerte(vorgaben)).toEqual({ max_dienst: undefined, min_ruhe: undefined });
  });

  it('belegt eigene Werte in Dauerform vor', () => {
    expect(grenzwerteFormWerte(eigene)).toEqual({ max_dienst: '10 h', min_ruhe: '7:30 h' });
  });
});

describe('grenzwerteBody (LLH-1603)', () => {
  it('sendet nichts, wenn sich nichts geändert hat', () => {
    expect(grenzwerteBody(vorgaben, { max_dienst: undefined, min_ruhe: '' })).toBeNull();
    expect(grenzwerteBody(eigene, { max_dienst: '10 h', min_ruhe: '7:30' })).toBeNull();
  });

  it('sendet nur das geänderte Feld, das andere fehlt im Body', () => {
    expect(grenzwerteBody(vorgaben, { max_dienst: '10 h', min_ruhe: undefined })).toEqual({
      max_dienst_minuten: 600,
    });
    expect('min_ruhe_minuten' in grenzwerteBody(vorgaben, { max_dienst: '10 h' })!).toBe(false);
  });

  it('macht aus einem geleerten Feld die Vorgabe (`null`)', () => {
    expect(grenzwerteBody(eigene, { max_dienst: '10 h', min_ruhe: '' })).toEqual({
      min_ruhe_minuten: null,
    });
  });

  it('nimmt den Wert der Vorgabe als eigenen Wert, wenn jemand ihn tippt', () => {
    expect(grenzwerteBody(vorgaben, { max_dienst: '12 h' })).toEqual({ max_dienst_minuten: 720 });
  });

  it('nimmt 0 als Mindestruhe, nicht als leer', () => {
    expect(grenzwerteBody(vorgaben, { min_ruhe: '0 min' })).toEqual({ min_ruhe_minuten: 0 });
  });
});

describe('vorgabenBody und rueckgaengigBody (LLH-1603)', () => {
  it('setzt nur eigene Werte auf die Vorgabe zurück', () => {
    expect(vorgabenBody(eigene)).toEqual({ max_dienst_minuten: null, min_ruhe_minuten: null });
    expect(vorgabenBody({ ...vorgaben, min_ruhe_minuten: 300, min_ruhe_eigen: true })).toEqual({
      min_ruhe_minuten: null,
    });
    expect(vorgabenBody(vorgaben)).toBeNull();
  });

  it('stellt mit Rückgängig die alten eigenen Minuten wieder her', () => {
    expect(rueckgaengigBody(eigene)).toEqual({ max_dienst_minuten: 600, min_ruhe_minuten: 450 });
    expect(rueckgaengigBody({ ...vorgaben, min_ruhe_minuten: 300, min_ruhe_eigen: true })).toEqual({
      min_ruhe_minuten: 300,
    });
  });
});
