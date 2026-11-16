/**
 * Die Ableitungsregel der Bediendichte als Wahrheitstafel (LFH-724, Spec `bedien-dichte`):
 * gespeicherte Wahl → Zeigerart → `kompakt`. Jede Zeile kann rot werden; die Mount-Tests in
 * `ThemeModeProvider.test.tsx` belegen nur, dass der Provider diese Funktion auch aufruft.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startDichte } from './dichte';
import { dichten, type Dichte } from './tokens';

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
 * Der Test führt das Skript selbst aus (gestubbter Speicher und Zeiger) und vergleicht es über
 * eine Tafel mit `startDichte`; Stufen aus `dichten`, die Zeigerabfrage aus `useViewport.ts`
 * (Nach-Review LLH-1719: ein Pin auf Zeichenketten hielt ein vertauschtes `!==` nicht).
 */
describe('Bootstrap-Spiegel der Dichte in index.html', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const skript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes('dataset.dichte'));
  const viewport = readFileSync(resolve(__dirname, '../components/useViewport.ts'), 'utf8');
  const ZEIGER_GROB = /const ZEIGER_GROB = '([^']+)'/.exec(viewport)?.[1];

  /** Führt das Bootstrap-Skript aus und liefert, was es an `data-dichte` setzt. */
  function bootstrap(gespeichert: string | null, zeigerGrob: boolean, speicherGesperrt = false) {
    const dataset: Record<string, string> = {};
    const speicher = {
      getItem: (schluessel: string) => {
        if (speicherGesperrt) throw new Error('SecurityError');
        return schluessel === 'lifeline-hub.dichte' ? gespeichert : null;
      },
    };
    const matchMedia = (abfrage: string) => ({ matches: zeigerGrob && abfrage === ZEIGER_GROB });
    new Function('localStorage', 'matchMedia', 'document', skript ?? '')(speicher, matchMedia, {
      documentElement: { dataset },
    });
    return dataset.dichte;
  }

  it('findet Skript und Zeigerabfrage', () => {
    expect(skript).toBeDefined();
    expect(ZEIGER_GROB).toBeDefined();
  });

  const STUFEN_AUS_THEME = Object.keys(dichten);
  for (const gespeichert of [null, '', 'riesig', 'Handschuh', ...STUFEN_AUS_THEME]) {
    for (const zeigerGrob of [true, false]) {
      it(`gespeichert ${JSON.stringify(gespeichert)}, Zeiger ${zeigerGrob ? 'grob' : 'fein'} → wie startDichte`, () => {
        expect(bootstrap(gespeichert, zeigerGrob)).toBe(startDichte(gespeichert, zeigerGrob));
      });
    }
  }

  for (const zeigerGrob of [true, false]) {
    it(`Speicher gesperrt, Zeiger ${zeigerGrob ? 'grob' : 'fein'} → wie startDichte ohne Wahl`, () => {
      expect(bootstrap('handschuh', zeigerGrob, true)).toBe(startDichte(null, zeigerGrob));
    });
  }
});
