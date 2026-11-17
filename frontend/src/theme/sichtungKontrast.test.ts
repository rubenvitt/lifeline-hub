import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import {
  farbenDunkel,
  farbenHell,
  mischeFarbe,
  SICHTUNG_SCHRAFFUR_DECKKRAFT,
  sichtungsKante,
  sichtungsPalette,
  sichtungsToenung,
  sichtungsflaechen,
  type SichtungsFarbe,
} from './tokens';

/**
 * Die Flächen der Sichtungswahl, GERECHNET statt behauptet (WCAG-Formel).
 *
 * LLH-1083, Spec `farbrollen-kontrast`, „Sichtungsfläche hält den Textboden“: Text auf jeder
 * gefüllten Fläche hält Tag ≥ 7 : 1 und Nacht ≥ 5 : 1 — die Flächentöne sind in beiden Modi
 * gleich (BBK-Farbton), also gilt der strengere Tagboden. Die Kante jeder Fläche liegt in der
 * Textfarbe des Modus und hält gegen Grund und Fläche ≥ 3 : 1 (WCAG 1.4.11). Herleitung:
 * `openspec/changes/archive/2026-10-18-knc0jyjd-sichtungswahl-flaechen/design.md`. Böden als Literale; der
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

/**
 * Getönte Kacheln und Schraffur (Change `eon26eat-farbe-entlasten`, D8; Spec `farbrollen-kontrast`,
 * „Sichtungsfläche hält den Textboden“, Szenario „Getönte Kachel nach einer Wahl“): eine nicht
 * gewählte Kachel steht nach einer Wahl getönt, ihr Text in der Textfarbe des Modus; „tot“ trägt
 * in jedem Zustand eine Schraffur. Gerechnet gegen den HELLSTEN bzw. dunkelsten Strich.
 */
const TEXTBODEN = { Tag: 7, Nacht: 5 } as const;
const FARBEN = Object.keys(sichtungsPalette) as SichtungsFarbe[];

describe.each([
  ['Tag', farbenHell],
  ['Nacht', farbenDunkel],
] as const)('Sichtungswahl getönt und schraffiert im %s (eon26eat D8)', (modus, farben) => {
  it.each(FARBEN)('%s: Text auf der getönten Kachel hält den Textboden', (farbe) => {
    const toenung = sichtungsToenung(farbe, farben.flaeche);
    expect(kontrast(farben.text, toenung)).toBeGreaterThanOrEqual(TEXTBODEN[modus]);
  });

  it('tot getönt: Text auf dem Strich der Schraffur hält den Textboden', () => {
    const toenung = sichtungsToenung('schwarz', farben.flaeche);
    const strich = mischeFarbe(farben.text, toenung, SICHTUNG_SCHRAFFUR_DECKKRAFT);
    expect(kontrast(farben.text, strich)).toBeGreaterThanOrEqual(TEXTBODEN[modus]);
  });

  it('die Tönung unterscheidet sich vom Grund der Maske, damit die Kategorie erkennbar bleibt', () => {
    for (const farbe of FARBEN.filter((f) => f !== 'schwarz')) {
      expect(sichtungsToenung(farbe, farben.flaeche)).not.toBe(farben.flaeche);
    }
  });
});

it('tot gefüllt: Schrift auf dem Strich der Schraffur hält den Tagboden (eon26eat D8)', () => {
  const { flaeche, schrift } = sichtungsPalette.schwarz;
  const strich = mischeFarbe(schrift, flaeche, SICHTUNG_SCHRAFFUR_DECKKRAFT);
  expect(kontrast(schrift, strich)).toBeGreaterThanOrEqual(TEXTBODEN.Tag);
});
