import { describe, expect, it } from 'vitest';
import { farbenDunkel, farbenHell } from '../../theme/tokens';
import { statusFlaeche, tonVonRolle, type StatusTon } from './statusFlaeche';

/**
 * Die Kontrastzusicherung der Statusfläche, GERECHNET statt behauptet (WCAG-Formel).
 * Böden aus Kriterium 5 der Bedien-Leitlinie, als Literale: Tag ≥ 7, Nacht ≥ 5 für den
 * Text; ≥ 3 für die Kante gegen ihren Grund (WCAG 1.4.11, wie `kraefte-kontrast.spec.ts`).
 * Aus der Palette gelesen und nicht aus einer Konstante: ändert jemand eine Rolle in
 * `tokens.ts`, wird dieser Test rot, bevor die e2e-Suite es wird.
 */
function luminanz(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a: string, b: string): number {
  const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TOENE: StatusTon[] = ['normal', 'achtung', 'alarm', 'bedien', 'neutral'];

describe('statusFlaeche — Kontrast', () => {
  it.each(TOENE)('Tag/%s: Text ≥ 7 : 1, Kante ≥ 3 : 1', (ton) => {
    const f = statusFlaeche(farbenHell, ton, false);
    expect(kontrast(f.text, f.grund)).toBeGreaterThanOrEqual(7);
    expect(kontrast(f.kante, f.grund)).toBeGreaterThanOrEqual(3);
  });

  it.each(TOENE)('Nacht/%s: Text ≥ 5 : 1, Kante ≥ 3 : 1', (ton) => {
    const f = statusFlaeche(farbenDunkel, ton, true);
    expect(kontrast(f.text, f.grund)).toBeGreaterThanOrEqual(5);
    expect(kontrast(f.kante, f.grund)).toBeGreaterThanOrEqual(3);
  });

  it('nachts ist der Text getönt wie im Entwurf', () => {
    expect(statusFlaeche(farbenDunkel, 'achtung', true).text).toBe(farbenDunkel.achtung);
    expect(statusFlaeche(farbenDunkel, 'alarm', true).text).toBe(farbenDunkel.alarm);
    expect(statusFlaeche(farbenDunkel, 'normal', true).text).toBe(farbenDunkel.normalText);
  });

  /**
   * Der Tagmodus-Sonderfall als Paar: getönt läge er unter dem Boden — genau deshalb
   * steht er hier. Wird `tokens.ts` um `achtungText`/`alarmText` ergänzt, kippt die erste
   * Hälfte, und die Rückkehr zum getönten Text wird eine bewusste Entscheidung.
   */
  it('am Tag trägt der getönte Text von achtung/alarm den Boden nicht — deshalb `text`', () => {
    expect(kontrast(farbenHell.achtung, farbenHell.achtungFlaeche)).toBeLessThan(7);
    expect(kontrast(farbenHell.alarm, farbenHell.alarmFlaeche)).toBeLessThan(7);
    expect(statusFlaeche(farbenHell, 'achtung', false).text).toBe(farbenHell.text);
    expect(statusFlaeche(farbenHell, 'alarm', false).text).toBe(farbenHell.text);
    // Die Fläche selbst bleibt getönt — der Ton ist nicht verloren.
    expect(statusFlaeche(farbenHell, 'alarm', false).grund).toBe(farbenHell.alarmFlaeche);
  });

  it('neutral ist flaeche3 + text2, nicht schwach (nachts unter 5)', () => {
    expect(statusFlaeche(farbenDunkel, 'neutral', true)).toMatchObject({
      grund: farbenDunkel.flaeche3,
      text: farbenDunkel.text2,
    });
    expect(kontrast(farbenDunkel.schwach, farbenDunkel.flaeche3)).toBeLessThan(5);
  });

  it('marke hat keine Statusfläche', () => {
    expect(tonVonRolle('marke')).toBeNull();
    expect(tonVonRolle('alarm')).toBe('alarm');
  });
});
