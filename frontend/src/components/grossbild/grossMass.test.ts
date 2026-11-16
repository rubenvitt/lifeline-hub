import { describe, expect, it } from 'vitest';
import { GROSS_BEZUG, grossMass } from './grossMass';

/** Rechnet einen Ausdruck von {@link grossMass} für ein Fenster aus, wie der Browser es täte. */
function ausrechnen(ausdruck: string, breite: number, hoehe: number, einheit?: number): number {
  const m = /^calc\(var\(--lfh-gross-einheit, min\(([\d.]+)vw, ([\d.]+)vh\)\) \* ([\d.]+)\)$/.exec(
    ausdruck,
  );
  if (!m) throw new Error(`kein Großbild-Maß: ${ausdruck}`);
  const px = einheit ?? Math.min((Number(m[1]) * breite) / 100, (Number(m[2]) * hoehe) / 100);
  return px * Number(m[3]);
}

describe('grossMass', () => {
  it('trifft bei 1920 × 1080 die Bezugsgröße', () => {
    for (const px of Object.values(GROSS_BEZUG)) {
      expect(ausrechnen(grossMass(px), 1920, 1080)).toBeCloseTo(px, 3);
    }
  });

  it('schrumpft auf einem Beamer mit 1280 × 720 auf zwei Drittel', () => {
    expect(ausrechnen(grossMass(GROSS_BEZUG.text), 1280, 720)).toBeCloseTo((28 * 2) / 3, 3);
  });

  it('wächst auf 4K auf das Doppelte', () => {
    expect(ausrechnen(grossMass(GROSS_BEZUG.zahl), 3840, 2160)).toBeCloseTo(192, 3);
  });

  it('richtet sich nach der knapperen Achse', () => {
    // 1920 × 600: die Höhe begrenzt, nichts läuft unten über den Rand.
    expect(ausrechnen(grossMass(GROSS_BEZUG.text), 1920, 600)).toBeCloseTo((28 * 600) / 1080, 3);
  });

  it('lässt sich von einem Vorfahren festsetzen', () => {
    expect(ausrechnen(grossMass(GROSS_BEZUG.text), 720, 400, 0.5)).toBe(14);
  });

  it('hält die Bezugswerte des Lagemonitors', () => {
    expect(GROSS_BEZUG).toMatchObject({ zahl: 96, zahlKlein: 72, titel: 32, text: 28 });
  });
});
