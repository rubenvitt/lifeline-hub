import { describe, expect, it } from 'vitest';
import { GEPLANT_RING_BILD, GEPLANT_RING_RADIUS_PX, geplantRingBild } from './geplantRing';
import { ZEICHEN_KARTEN_PX } from './markerIcons';

/** RGBA des Pixels, das in CSS-px um (dx, dy) neben der Mitte liegt. */
function pixel(dx: number, dy: number): [number, number, number, number] {
  const b = geplantRingBild();
  const mitte = b.width / 2;
  const x = Math.floor(mitte + dx * b.pixelRatio);
  const y = Math.floor(mitte + dy * b.pixelRatio);
  const i = (y * b.width + x) * 4;
  return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]];
}

/** Ein Punkt im Abstand `r` (CSS-px) unter dem Winkel `grad` (0° = rechts, im Uhrzeigersinn). */
function polar(r: number, grad: number): [number, number] {
  const a = (grad * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

const SCHWARZ = [0, 0, 0, 255];
const WEISS = [255, 255, 255, 255];
const LEER = [0, 0, 0, 0];

describe('geplantRingBild (LLH-1107)', () => {
  it('ist ein quadratisches Bild in doppelter Dichte, der Ring liegt außerhalb des Zeichens', () => {
    const b = geplantRingBild();
    expect(b.width).toBe(b.height);
    expect(b.pixelRatio).toBe(2);
    expect(b.data).toHaveLength(b.width * b.height * 4);
    // Das Zeichen ist auf ZEICHEN_KARTEN_PX normiert; der Ring darf es nicht überdecken.
    expect(GEPLANT_RING_RADIUS_PX - 3).toBeGreaterThan(ZEICHEN_KARTEN_PX / 2);
    expect(GEPLANT_RING_BILD).toBe('ring|geplant');
  });

  it('lässt die Mitte frei — das Zeichen bleibt sichtbar', () => {
    expect(pixel(0, 0)).toEqual(LEER);
    expect(pixel(...polar(10, 15))).toEqual(LEER);
  });

  it('zeichnet einen Strich: schwarzer Kern mit weißen Kanten, lesbar auf hellem wie dunklem Grund', () => {
    // 6° liegt mitten im ersten Strich (zwölf Striche, je 60 % von 30°).
    expect(pixel(...polar(GEPLANT_RING_RADIUS_PX - 1.5, 6))).toEqual(SCHWARZ);
    expect(pixel(...polar(GEPLANT_RING_RADIUS_PX - 0.5, 6))).toEqual(WEISS);
    expect(pixel(...polar(GEPLANT_RING_RADIUS_PX - 3.5, 6))).toEqual(WEISS);
  });

  it('ist gestrichelt: zwischen zwei Strichen liegt eine Lücke', () => {
    // 24° liegt in der Lücke nach dem ersten Strich.
    expect(pixel(...polar(GEPLANT_RING_RADIUS_PX - 1.5, 24))).toEqual(LEER);
    // Der nächste Strich beginnt bei 30°.
    expect(pixel(...polar(GEPLANT_RING_RADIUS_PX - 1.5, 36))).toEqual(SCHWARZ);
  });
});
