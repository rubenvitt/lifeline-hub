import { describe, expect, it } from 'vitest';
import { verfasserText } from './verfasser';

describe('verfasserText — Verfasser mit Funktion (LFH-615)', () => {
  it('setzt die Funktion hinter den Namen', () => {
    expect(verfasserText({ erfasser_name: 'Vitt', erfasser_funktion: 'S2' })).toBe(
      'Vitt ·\u00A0S2',
    );
    expect(verfasserText({ erfasser_name: 'Brandt', erfasser_funktion: 'EL' })).toBe(
      'Brandt ·\u00A0EL',
    );
  });

  it('bricht höchstens VOR dem Punkt, nie zwischen Punkt und Kürzel', () => {
    const text = verfasserText({ erfasser_name: 'Administrator', erfasser_funktion: 'EL' });
    expect(text.split(' ')).toEqual(['Administrator', '·\u00A0EL']);
  });

  it('erfindet ohne Snapshot keine Funktion', () => {
    expect(verfasserText({ erfasser_name: 'Vitt' })).toBe('Vitt');
    expect(verfasserText({ erfasser_name: 'Vitt', erfasser_funktion: null })).toBe('Vitt');
    expect(verfasserText({ erfasser_name: 'Vitt', erfasser_funktion: '  ' })).toBe('Vitt');
  });
});
