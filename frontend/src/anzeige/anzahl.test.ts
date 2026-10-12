import { describe, expect, it } from 'vitest';
import { anzahl, segmentLabel } from './anzahl';

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

describe('segmentLabel', () => {
  it('hängt eine bekannte Menge in Klammern an, auch null', () => {
    expect(segmentLabel('Offen', 3)).toBe('Offen (3)');
    expect(segmentLabel('Offen', 0)).toBe('Offen (0)');
  });

  it('lässt eine unbekannte Menge weg', () => {
    expect(segmentLabel('Offen', null)).toBe('Offen');
  });
});
