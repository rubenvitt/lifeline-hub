import { describe, expect, it } from 'vitest';
import { legeAufUnterlage, ZEICHEN_UNTERLAGE } from './unterlage';

/** Ein Rasterbild aus Pixeln `[r, g, b, a]`, Zeile für Zeile. */
function bild(breite: number, pixel: number[][]) {
  return {
    width: breite,
    height: pixel.length / breite,
    data: new Uint8ClampedArray(pixel.flat()),
  };
}

const UNTERLAGE_RGB = [1, 3, 5].map((i) => Number.parseInt(ZEICHEN_UNTERLAGE.slice(i, i + 2), 16));

// LLH-1141: die Lagekarte rastert ihre Zeichen auf die helle Unterlage, wie das HTML-Zeichen sie
// als Hintergrund trägt. Gemessen im e2e „Zeichenkontrast“ der Lagekarte.
describe('legeAufUnterlage', () => {
  it('füllt durchsichtige Pixel deckend mit der Unterlage und lässt deckende Striche stehen', () => {
    const roh = bild(2, [
      [0, 0, 0, 0],
      [0, 0, 0, 255],
    ]);
    const aus = legeAufUnterlage(roh);
    expect(Array.from(aus.data)).toEqual([...UNTERLAGE_RGB, 255, 0, 0, 0, 255]);
  });

  it('mischt halbdurchsichtige Kanten (Kantenglättung) über die Unterlage', () => {
    const aus = legeAufUnterlage(bild(1, [[0, 0, 0, 128]]));
    const erwartet = UNTERLAGE_RGB.map((k) => Math.round((k * 127) / 255));
    expect(Array.from(aus.data)).toEqual([...erwartet, 255]);
  });

  it('behält die Maße und verändert das Ausgangsbild nicht', () => {
    const roh = bild(2, [
      [10, 20, 30, 0],
      [200, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const vorher = Array.from(roh.data);
    const aus = legeAufUnterlage(roh);
    expect([aus.width, aus.height]).toEqual([2, 2]);
    expect(Array.from(roh.data)).toEqual(vorher);
    // Jedes Pixel ist danach deckend: kein Kartengrund scheint durch.
    expect(Array.from(aus.data).filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 255]);
  });
});
