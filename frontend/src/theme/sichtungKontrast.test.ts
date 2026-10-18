import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import { farbenDunkel, farbenHell, sichtungsKante, sichtungsflaechen } from './tokens';

/**
 * Die Flächen der Sichtungswahl, GERECHNET statt behauptet (WCAG-Formel).
 *
 * LLH-1083, Spec `farbrollen-kontrast`, „Sichtungsfläche hält den Textboden“: Text auf jeder
 * gefüllten Fläche hält Tag ≥ 7 : 1 und Nacht ≥ 5 : 1 — die Flächentöne sind in beiden Modi
 * gleich (BBK-Farbton), also gilt der strengere Tagboden. Die Kante jeder Fläche liegt in der
 * Textfarbe des Modus und hält gegen Grund und Fläche ≥ 3 : 1 (WCAG 1.4.11). Herleitung:
 * `openspec/changes/knc0jyjd-sichtungswahl-flaechen/design.md`. Böden als Literale; der
 * Browser-Nachweis steht in `e2e/betroffene-kontrast.spec.ts`.
 */
const TEXTBODEN_TAG = 7;
const RANDBODEN = 3;

describe('Sichtungsflächen — Text (LLH-1083)', () => {
  it.each(Object.entries(sichtungsflaechen))('%s: Schrift auf der Fläche ≥ 7 : 1', (_k, f) => {
    expect(kontrast(f.schrift, f.flaeche)).toBeGreaterThanOrEqual(TEXTBODEN_TAG);
  });
});

describe.each([
  ['Tag', farbenHell],
  ['Nacht', farbenDunkel],
] as const)('Sichtungsflächen — Kante im %s (LLH-1083)', (_modus, farben) => {
  it.each(Object.keys(sichtungsflaechen))('%s: Kante gegen Grund und Fläche ≥ 3 : 1', () => {
    // Die Kante grenzt die Fläche vom Untergrund ab, auf dem sie steht.
    const kante = sichtungsKante(farben);
    expect(kontrast(kante, farben.grund)).toBeGreaterThanOrEqual(RANDBODEN);
    expect(kontrast(kante, farben.flaeche)).toBeGreaterThanOrEqual(RANDBODEN);
  });

  it('ohne Kante läge mindestens eine Fläche unter 3 : 1 — die Kante ist nötig', () => {
    const ohneKante = Object.values(sichtungsflaechen).some(
      (f) => kontrast(f.flaeche, farben.grund) < RANDBODEN,
    );
    expect(ohneKante).toBe(true);
  });
});
