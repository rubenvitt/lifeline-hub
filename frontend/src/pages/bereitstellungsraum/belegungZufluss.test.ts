import { describe, expect, it } from 'vitest';
import { geordnet, ordnungsschluessel, zuflussText } from './belegungZufluss';

describe('feste Reihenfolge der Belegung (LFH-1113)', () => {
  it('ordnet ohne Groß/Klein und Akzente, Zahlen nach Wert', () => {
    const namen = ['Zug 2', 'Florian 10', 'florian 2', 'Ärzte', 'Florian 1', 'Zug 10'];
    const liste = namen.map((name, i) => ({ id: i + 1, name }));
    expect(geordnet(liste, (e) => ordnungsschluessel(e.name)).map((e) => e.name)).toEqual([
      'Ärzte',
      'Florian 1',
      'florian 2',
      'Florian 10',
      'Zug 2',
      'Zug 10',
    ]);
  });

  it('gleicher Name: die Id entscheidet, nicht die Lieferfolge', () => {
    const liste = [
      { id: 7, name: 'Einheit' },
      { id: 3, name: 'Einheit' },
    ];
    expect(geordnet(liste, (e) => ordnungsschluessel(e.name)).map((e) => e.id)).toEqual([3, 7]);
  });
});

describe('Wortlaut des Banners', () => {
  const einheiten = ['neue Einheit', 'neue Einheiten'] as const;

  it('nennt die Zahl in Einzahl und Mehrzahl', () => {
    expect(zuflussText(1, einheiten, false)).toBe('1 neue Einheit');
    expect(zuflussText(3, einheiten, false)).toBe('3 neue Einheiten');
  });

  it('nennt eine fremde Umordnung', () => {
    expect(zuflussText(0, einheiten, true)).toBe('Reihenfolge geändert');
    expect(zuflussText(2, einheiten, true)).toBe('2 neue Einheiten · Reihenfolge geändert');
  });
});
