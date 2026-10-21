import { describe, expect, it } from 'vitest';
import { bildSkala, LAGEPLAN_BILD_MAX_PX, legendenSpalten } from './lageplanBild';

describe('bildSkala', () => {
  it('nimmt die Gerätepixel, solange das Bild unter der Grenze bleibt', () => {
    expect(bildSkala({ breitePx: 1600, hoehePx: 1000, cssBreite: 800 })).toBe(2);
  });

  it('deckelt die längste Kante bei sehr dichten Bildschirmen', () => {
    const s = bildSkala({ breitePx: 6000, hoehePx: 3000, cssBreite: 2000 });
    expect(2000 * s).toBe(LAGEPLAN_BILD_MAX_PX);
  });
});

describe('legendenSpalten', () => {
  it('eine Spalte je 220 CSS-px, eine bis vier', () => {
    expect(legendenSpalten(150)).toBe(1);
    expect(legendenSpalten(700)).toBe(3);
    expect(legendenSpalten(1800)).toBe(4);
  });
});
