/**
 * Die Ableitungsregel der Bediendichte als Wahrheitstafel (LFH-724, Spec `bedien-dichte`):
 * gespeicherte Wahl → Zeigerart → `kompakt`. Jede Zeile kann rot werden; die Mount-Tests in
 * `ThemeModeProvider.test.tsx` belegen nur, dass der Provider diese Funktion auch aufruft.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * Der Spiegel in `index.html` (LLH-1774, Review vor dem PR): das Bootstrap-Skript setzt
 * `data-dichte` vor dem ersten Bild, sonst rechnen die Schriftvariablen (`--lfh-schrift-faktor`)
 * im ersten Bild mit `kompakt`, antd aber schon mit der Stufe, und Text springt nach dem Mount.
 * Es spiegelt `startDichte`: gespeicherte Wahl, sonst grober Zeiger → `komfortabel`, sonst
 * `kompakt`. Diese Handkopie hält der Test an Schlüssel, Stufen und Zeigerabfrage.
 */
describe('Bootstrap-Spiegel der Dichte in index.html', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

  it('liest denselben Schlüssel und kennt genau die drei Stufen', () => {
    expect(html).toContain("localStorage.getItem('lifeline-hub.dichte')");
    const liste = /var dichten = \[([^\]]*)\];/.exec(html)?.[1] ?? '';
    expect(liste.split(',').map((w) => w.trim().replace(/'/g, ''))).toEqual([
      'kompakt',
      'komfortabel',
      'handschuh',
    ]);
  });

  it('fällt ohne Wahl wie startDichte auf die Zeigerart zurück und setzt das Merkmal', () => {
    expect(html).toContain("matchMedia('(pointer: coarse)').matches ? 'komfortabel' : 'kompakt'");
    expect(html).toContain('document.documentElement.dataset.dichte = d;');
  });
});
