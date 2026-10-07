import { describe, expect, it } from 'vitest';
import { anzahl } from './anzahl';

describe('anzahl', () => {
  it('nimmt bei genau eins die Einzahl', () => {
    expect(anzahl(1, 'Mitglied', 'Mitglieder')).toBe('1 Mitglied');
  });

  it('nimmt bei null und ab zwei die Mehrzahl', () => {
    expect(anzahl(0, 'Kanal', 'Kanäle')).toBe('0 Kanäle');
    expect(anzahl(2, 'Kanal', 'Kanäle')).toBe('2 Kanäle');
  });

  it('stellt die Zahl vor das Wort', () => {
    expect(anzahl(12, 'Befehl', 'Befehle')).toBe('12 Befehle');
  });
});
