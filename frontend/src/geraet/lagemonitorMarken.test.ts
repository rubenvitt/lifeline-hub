import { describe, expect, it } from 'vitest';
import { MARKEN_ABSTAND, placeMarken, type Box, type MarkenEingabe } from './lagemonitorMarken';

/**
 * Platzierung der Kartenmarken des Lagemonitors (LLH-1933): keine Marke deckt den Einsatzort, keine
 * eine andere, keine ragt aus der Kachel.
 *
 * Mutationsprobe: Hindernisse nicht prüfen → „Schwerpunkt auf dem Einsatzort“ rot; bereits gesetzte
 * Marken nicht prüfen → „zwei Marken am selben Ort“ rot; Kachelrand nicht prüfen → „am Rand“ rot;
 * immer den ersten Kandidaten nehmen statt der geringsten Überdeckung → „kein freier Platz“ rot.
 */

const KACHEL = { width: 1000, height: 600 };

/** Rahmen einer Marke nach ihrem Versatz: mittig am Anker, verschoben um `dx`/`dy`. */
function rahmen(m: MarkenEingabe, v: { dx: number; dy: number }): Box {
  return {
    left: m.anchor.x + v.dx - m.width / 2,
    top: m.anchor.y + v.dy - m.height / 2,
    width: m.width,
    height: m.height,
  };
}

function ueberlappen(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

function innerhalb(b: Box): boolean {
  return (
    b.left >= 0 &&
    b.top >= 0 &&
    b.left + b.width <= KACHEL.width &&
    b.top + b.height <= KACHEL.height
  );
}

/** Der Punkt des Einsatzorts: 36 px (28 px und 4 px Rand) um seinen Mittelpunkt. */
function punkt(x: number, y: number): Box {
  return { left: x - 18, top: y - 18, width: 36, height: 36 };
}

describe('placeMarken (LLH-1933)', () => {
  it('liegt der Schwerpunkt eines Gefahrengebiets auf dem Einsatzort, bleibt der Punkt frei', () => {
    const einsatzort = punkt(500, 300);
    const zone: MarkenEingabe = { anchor: { x: 500, y: 300 }, width: 520, height: 40 };
    const [v] = placeMarken({ area: KACHEL, obstacles: [einsatzort], marken: [zone] });
    const b = rahmen(zone, v);
    expect(ueberlappen(b, einsatzort)).toBe(false);
    expect(innerhalb(b)).toBe(true);
  });

  it('eine freie Marke bleibt mittig an ihrem Punkt', () => {
    const m: MarkenEingabe = { anchor: { x: 200, y: 200 }, width: 120, height: 40 };
    expect(placeMarken({ area: KACHEL, obstacles: [punkt(700, 400)], marken: [m] })).toEqual([
      { dx: 0, dy: 0 },
    ]);
  });

  it('zwei Marken am selben Ort: die erste bleibt, die zweite weicht aus', () => {
    const uhs: MarkenEingabe = { anchor: { x: 500, y: 300 }, width: 400, height: 40 };
    const abschnitt: MarkenEingabe = { anchor: { x: 480, y: 310 }, width: 100, height: 40 };
    const [vu, va] = placeMarken({ area: KACHEL, obstacles: [], marken: [uhs, abschnitt] });
    expect(vu).toEqual({ dx: 0, dy: 0 });
    expect(ueberlappen(rahmen(uhs, vu), rahmen(abschnitt, va))).toBe(false);
  });

  it('hält zwischen Marken einen Abstand', () => {
    const a: MarkenEingabe = { anchor: { x: 500, y: 300 }, width: 200, height: 40 };
    const b: MarkenEingabe = { anchor: { x: 500, y: 300 }, width: 200, height: 40 };
    const [va, vb] = placeMarken({ area: KACHEL, obstacles: [], marken: [a, b] });
    const ra = rahmen(a, va);
    const rb = rahmen(b, vb);
    const luft = Math.max(
      rb.left - (ra.left + ra.width),
      ra.left - (rb.left + rb.width),
      rb.top - (ra.top + ra.height),
      ra.top - (rb.top + rb.height),
    );
    expect(luft).toBeGreaterThanOrEqual(MARKEN_ABSTAND);
  });

  it('eine Marke am Rand rückt ganz in die Kachel', () => {
    const m: MarkenEingabe = { anchor: { x: 990, y: 300 }, width: 200, height: 40 };
    const [v] = placeMarken({ area: KACHEL, obstacles: [], marken: [m] });
    expect(innerhalb(rahmen(m, v))).toBe(true);
  });

  it('viele Marken auf engem Raum überdecken sich nicht, solange Platz ist', () => {
    const marken: MarkenEingabe[] = Array.from({ length: 6 }, (_, i) => ({
      anchor: { x: 500 + i, y: 300 },
      width: 240,
      height: 40,
    }));
    const einsatzort = punkt(500, 300);
    const versatz = placeMarken({ area: KACHEL, obstacles: [einsatzort], marken });
    const boxen = marken.map((m, i) => rahmen(m, versatz[i]));
    for (const [i, b] of boxen.entries()) {
      expect(ueberlappen(b, einsatzort), `Marke ${i} deckt den Einsatzort`).toBe(false);
      expect(innerhalb(b), `Marke ${i} ragt hinaus`).toBe(true);
      for (const c of boxen.slice(i + 1)) expect(ueberlappen(b, c)).toBe(false);
    }
  });

  it('ohne freien Platz: die Marke bleibt und nimmt die geringste Überdeckung', () => {
    // Die Kachel ist so klein, dass jede Lage die erste Marke berührt; die zweite bleibt trotzdem.
    const enge = { width: 260, height: 60 };
    const a: MarkenEingabe = { anchor: { x: 130, y: 30 }, width: 240, height: 40 };
    const b: MarkenEingabe = { anchor: { x: 130, y: 30 }, width: 240, height: 40 };
    const [va, vb] = placeMarken({ area: enge, obstacles: [], marken: [a, b] });
    expect(va).toEqual({ dx: 0, dy: 0 });
    const ra = rahmen(a, va);
    const rb = rahmen(b, vb);
    // Mittig läge sie ganz auf der ersten (240 × 40 = 9600 px²); gewählt ist weniger.
    const breite = Math.min(ra.left + ra.width, rb.left + rb.width) - Math.max(ra.left, rb.left);
    const hoehe = Math.min(ra.top + ra.height, rb.top + rb.height) - Math.max(ra.top, rb.top);
    expect(Math.max(0, breite) * Math.max(0, hoehe)).toBeLessThan(240 * 40);
  });
});
