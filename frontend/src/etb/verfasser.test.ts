import { describe, expect, it } from 'vitest';
import { verfasserText } from './verfasser';

describe('verfasserText — Verfasser mit Funktion (LFH-615)', () => {
  it('setzt die Funktion hinter den Namen', () => {
    expect(verfasserText({ erfasser_name: 'Vitt', erfasser_funktion: 'S2' })).toBe('Vitt · S2');
    expect(verfasserText({ erfasser_name: 'Brandt', erfasser_funktion: 'EL' })).toBe('Brandt · EL');
  });

  it('erfindet ohne Snapshot keine Funktion', () => {
    expect(verfasserText({ erfasser_name: 'Vitt' })).toBe('Vitt');
    expect(verfasserText({ erfasser_name: 'Vitt', erfasser_funktion: null })).toBe('Vitt');
    expect(verfasserText({ erfasser_name: 'Vitt', erfasser_funktion: '  ' })).toBe('Vitt');
  });
});
