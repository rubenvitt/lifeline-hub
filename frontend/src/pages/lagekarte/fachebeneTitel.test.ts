import { describe, expect, it } from 'vitest';
import { fachebeneTitel, pick, titelCase } from './fachebeneTitel';

describe('fachebeneTitel (LFH-812)', () => {
  it('DWD: das Ereignis in Titelschreibung, ohne Zeichen davor', () => {
    expect(fachebeneTitel('dwd', { EVENT: 'STARKES GEWITTER', EC_GROUP: 'THUNDERSTORM' })).toBe(
      'Starkes Gewitter',
    );
    expect(fachebeneTitel('dwd', { event: 'frost' })).toBe('Frost');
  });

  it('DWD ohne Ereignis: „Wetterwarnung"', () => {
    expect(fachebeneTitel('dwd', {})).toBe('Wetterwarnung');
  });

  it('NINA: „Amtliche Warnung"', () => {
    expect(fachebeneTitel('nina', { HEADLINE: 'Warnung vor X' })).toBe('Amtliche Warnung');
  });

  it('übrige Ebenen: titel, dann name, dann der Name der Ebene', () => {
    expect(fachebeneTitel('pegelonline', { titel: 'Dresden', name: 'x' })).toBe('Dresden');
    expect(fachebeneTitel('kritis', { name: 'Uniklinik' })).toBe('Uniklinik');
    expect(fachebeneTitel('kritis', { name: '  ' })).toBe('KRITIS / sensible Objekte');
  });

  it('kein Emoji im Titel', () => {
    for (const t of [
      fachebeneTitel('dwd', { EVENT: 'STURMBÖEN' }),
      fachebeneTitel('nina', {}),
      fachebeneTitel('energie', {}),
    ]) {
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('pick / titelCase', () => {
  it('pick nimmt das erste nicht-leere Feld, Zahlen als Text', () => {
    expect(pick({ a: ' ', b: 3, c: 'x' }, 'a', 'b', 'c')).toBe('3');
    expect(pick({}, 'a')).toBeNull();
  });

  it('titelCase schreibt Wörter groß, auch nach Bindestrich', () => {
    expect(titelCase('STARKES GEWITTER')).toBe('Starkes Gewitter');
    expect(titelCase('NORD-OST')).toBe('Nord-Ost');
  });
});
