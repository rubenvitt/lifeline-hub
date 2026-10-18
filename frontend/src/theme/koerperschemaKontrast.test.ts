import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import { farbenDunkel, farbenHell, koerperschemaFarben } from './tokens';

/**
 * Kontrast des Körperschemas (LLH-1120, design.md D13, Spec `koerperschema`), GERECHNET statt
 * behauptet (WCAG-Formel), Muster `sichtungKontrast.test.ts`. Das Schema steht auf dem Grund der
 * Seite (Paneel im Patientenkopf) oder auf einer Fläche (Datenfeld, Schnellansicht).
 *
 * - Die Kontur der Silhouette grenzt die Figur ab: ≥ 3 : 1 gegen jeden Untergrund (WCAG 1.4.11).
 * - Sternchen und Nummer sind Text: auf der Silhouette und daneben Tag ≥ 7 : 1, Nacht ≥ 5 : 1
 *   (Textboden, `frontend/AGENTS.md`).
 * - Fokus und Wahl einer Region (`bedien`): ≥ 3 : 1 auf Silhouette und Untergrund.
 *
 * Böden als Literale; der Browser-Nachweis steht in `e2e/betroffene-kontrast.spec.ts`.
 */
const RANDBODEN = 3;

describe.each([
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
] as const)('Körperschema im %s', (_modus, farben, textboden) => {
  const k = koerperschemaFarben(farben);
  const untergruende = { grund: farben.grund, flaeche: farben.flaeche, flaeche2: farben.flaeche2 };

  it.each(Object.entries(untergruende))('Kontur gegen %s ≥ 3 : 1', (_name, grund) => {
    expect(kontrast(k.kontur, grund)).toBeGreaterThanOrEqual(RANDBODEN);
  });

  it('Kontur gegen die eigene Fläche ≥ 3 : 1', () => {
    expect(kontrast(k.kontur, k.silhouette)).toBeGreaterThanOrEqual(RANDBODEN);
  });

  it('Sternchen und Nummer auf der Silhouette halten den Textboden', () => {
    expect(kontrast(k.stern, k.silhouette)).toBeGreaterThanOrEqual(textboden);
  });

  it.each(Object.entries(untergruende))(
    'Sternchen neben der Silhouette auf %s halten den Textboden',
    (_name, grund) => {
      expect(kontrast(k.stern, grund)).toBeGreaterThanOrEqual(textboden);
    },
  );

  it.each(Object.entries({ silhouette: k.silhouette, ...untergruende }))(
    'Fokus und Wahl (bedien) auf %s ≥ 3 : 1',
    (_name, grund) => {
      expect(kontrast(k.bedien, grund)).toBeGreaterThanOrEqual(RANDBODEN);
    },
  );

  it('ohne Kontur verschwände die Figur: die Fläche allein liegt unter 3 : 1', () => {
    expect(kontrast(k.silhouette, farben.flaeche)).toBeLessThan(RANDBODEN);
  });

  it('das Sternchen trägt die Textfarbe, nicht die Alarmfarbe', () => {
    expect(k.stern).toBe(farben.text);
    expect(k.stern).not.toBe(farben.alarm);
  });
});
