import { describe, expect, it } from 'vitest';
import { statusFlaeche, type StatusTon } from '../components/instrument/statusFlaeche';
import { farbenDunkel, farbenHell, type Farbrollen } from './tokens';

/**
 * Status, Marke und Statusknopf, GERECHNET (Spec `status-darstellung`, Change
 * `eon26eat-status-und-bedienung`, D2 und D4). Böden als Literale: Text Tag ≥ 7 : 1, Nacht
 * ≥ 5 : 1; der Rahmen des Statusknopfs ≥ 3 : 1 (WCAG 1.4.11) gegen jede Fläche, auf der eine
 * Zeile oder Kachel steht, und gegen die eigene Knopffläche.
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
  const [x, y] = [luminanz(a), luminanz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const MODI: [string, Farbrollen, number][] = [
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
];
const TOENE: StatusTon[] = ['normal', 'achtung', 'alarm', 'bedien', 'neutral'];

describe.each(MODI)('%s', (_modus, rollen, textboden) => {
  it('die Beschriftung einer Marke hält den Textboden auf flaeche2', () => {
    expect(kontrast(rollen.gedaempft, rollen.flaeche2)).toBeGreaterThanOrEqual(textboden);
    // entfernbar: Haupttext
    expect(kontrast(rollen.text, rollen.flaeche2)).toBeGreaterThanOrEqual(textboden);
  });

  it('Rahmen einer entfernbaren Marke und der bedienbaren Sichtung (`steuerRahmen`) ≥ 3 : 1', () => {
    for (const umgebung of [rollen.flaeche2, rollen.flaeche, rollen.grund, rollen.paneel]) {
      expect(kontrast(rollen.steuerRahmen, umgebung), `gegen ${umgebung}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it('eine Marke ist vom neutralen Status unterscheidbar (andere Fläche oder andere Schrift)', () => {
    const neutral = statusFlaeche(rollen, 'neutral');
    expect(rollen.flaeche2 !== neutral.grund || rollen.gedaempft !== neutral.text).toBe(true);
  });

  it.each(TOENE)('Statusknopf %s: Rahmen ≥ 3 : 1 gegen Zeilenflächen und eigene Fläche', (ton) => {
    const f = statusFlaeche(rollen, ton);
    for (const umgebung of [rollen.grund, rollen.flaeche, rollen.paneel, rollen.flaeche2]) {
      expect(kontrast(f.kante, umgebung), `gegen ${umgebung}`).toBeGreaterThanOrEqual(3);
    }
    expect(kontrast(f.kante, f.grund)).toBeGreaterThanOrEqual(3);
  });

  it.each(TOENE)('Statusknopf %s: Beschriftung hält den Textboden', (ton) => {
    const f = statusFlaeche(rollen, ton);
    expect(kontrast(f.text, f.grund)).toBeGreaterThanOrEqual(textboden);
  });
});
