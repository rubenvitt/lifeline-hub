/**
 * Die Ableitungsregel der Bediendichte als Wahrheitstafel (LFH-724, Spec `bedien-dichte`):
 * gespeicherte Wahl → Zeigerart → `kompakt`. Jede Zeile kann rot werden; die Mount-Tests in
 * `ThemeModeProvider.test.tsx` belegen nur, dass der Provider diese Funktion auch aufruft.
 */
import { describe, expect, it } from 'vitest';
import { startDichte } from './dichte';
import type { Dichte } from './tokens';

const STUFEN: Dichte[] = ['kompakt', 'komfortabel', 'handschuh'];

describe('startDichte — die Wahl gewinnt immer (LFH-724)', () => {
  for (const stufe of STUFEN) {
    it(`gespeichert ${stufe}, grober Zeiger → ${stufe}`, () => {
      expect(startDichte(stufe, true)).toBe(stufe);
    });
    it(`gespeichert ${stufe}, feiner Zeiger → ${stufe}`, () => {
      expect(startDichte(stufe, false)).toBe(stufe);
    });
  }
});

describe('startDichte — ohne Wahl entscheidet die Zeigerart (LFH-724)', () => {
  it('nichts gespeichert, grober Zeiger → komfortabel', () => {
    expect(startDichte(null, true)).toBe('komfortabel');
  });

  it('nichts gespeichert, feiner Zeiger → kompakt', () => {
    expect(startDichte(null, false)).toBe('kompakt');
  });

  // Ein unbrauchbarer Wert ist „keine Wahl“ und fällt auf die Zeigerart, nicht pauschal auf
  // kompakt — sonst startete ein Touchgerät mit verdorbenem Speicher zu eng.
  it('unbrauchbarer Wert, grober Zeiger → komfortabel', () => {
    expect(startDichte('riesig', true)).toBe('komfortabel');
  });

  it('unbrauchbarer Wert, feiner Zeiger → kompakt', () => {
    expect(startDichte('riesig', false)).toBe('kompakt');
  });

  // Groß-/Kleinschreibung zählt: der Speicher schreibt nur, was `setDichte` bekam.
  it('„Handschuh“ (großgeschrieben) ist keine Stufe', () => {
    expect(startDichte('Handschuh', false)).toBe('kompakt');
  });
});

describe('startDichte — Handschuh nur auf Wahl (LFH-724)', () => {
  for (const gespeichert of [null, '', 'riesig']) {
    for (const zeigerGrob of [true, false]) {
      it(`gespeichert ${JSON.stringify(gespeichert)}, Zeiger ${zeigerGrob ? 'grob' : 'fein'} → nie handschuh`, () => {
        expect(startDichte(gespeichert, zeigerGrob)).not.toBe('handschuh');
      });
    }
  }
});
