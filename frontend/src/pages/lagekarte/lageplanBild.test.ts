import { describe, expect, it } from 'vitest';
import { GEDAEMPFT_DECKKRAFT } from './abschnittFokus';
import type { KartenBuendel } from './kartenAufnahme';
import { bildSkala, LAGEPLAN_BILD_MAX_PX, legendenSpalten, zeichneBuendel } from './lageplanBild';

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

/** Leinwand-Attrappe: merkt sich die Deckkraft bei jedem Strich, Füllen und Text. */
function leinwand() {
  const deckkraft: number[] = [];
  const stapel: number[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    save() {
      stapel.push(ctx.globalAlpha);
    },
    restore() {
      ctx.globalAlpha = stapel.pop() ?? 1;
    },
    beginPath() {},
    moveTo() {},
    arc() {},
    closePath() {},
    fill() {
      deckkraft.push(ctx.globalAlpha);
    },
    fillText() {
      deckkraft.push(ctx.globalAlpha);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, deckkraft, roh: ctx };
}

describe('zeichneBuendel (LLH-1349)', () => {
  const buendel: KartenBuendel = {
    x: 10,
    y: 10,
    durchmesser: 40,
    ring: 6,
    segmente: [{ farbe: '#16a34a', anteil: 1 }],
    neutral: '#94a3b8',
    zahl: '3',
    kurz: null,
    gedaempft: false,
  };

  it('zeichnet ein Bündel nur aus fremden Kräften mit der Deckkraft der Karte', () => {
    const { ctx, deckkraft, roh } = leinwand();
    zeichneBuendel(ctx, { ...buendel, gedaempft: true }, 1, 0);
    expect(deckkraft.length).toBeGreaterThan(0);
    expect(new Set(deckkraft)).toEqual(new Set([GEDAEMPFT_DECKKRAFT]));
    // Danach zeichnet der Rest des Blatts wieder voll.
    expect(roh.globalAlpha).toBe(1);
  });

  it('ein volles Bündel bleibt voll', () => {
    const { ctx, deckkraft } = leinwand();
    zeichneBuendel(ctx, buendel, 1, 0);
    expect(new Set(deckkraft)).toEqual(new Set([1]));
  });
});
