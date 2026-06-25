import { describe, it, expect } from 'vitest';
import { spiderfyOffsets, SPIDER_LEAF_ABSTAND } from './spiderfy';

// kleinster paarweiser Abstand über alle Offset-Paare
function minAbstand(offs: { x: number; y: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < offs.length; i++) {
    for (let j = i + 1; j < offs.length; j++) {
      const d = Math.hypot(offs[i].x - offs[j].x, offs[i].y - offs[j].y);
      if (d < min) min = d;
    }
  }
  return min;
}

describe('spiderfyOffsets', () => {
  it('liefert keine Offsets für 0 und genau einen (vom Anker abgesetzten) für 1', () => {
    expect(spiderfyOffsets(0)).toEqual([]);
    const eins = spiderfyOffsets(1);
    expect(eins).toHaveLength(1);
    expect(Math.hypot(eins[0].x, eins[0].y)).toBeGreaterThanOrEqual(SPIDER_LEAF_ABSTAND - 0.001);
  });

  it('Kreis bis 9: count stimmt, alle auf gleichem Radius, kein Overlap (≥ Icon-Größe)', () => {
    for (const n of [2, 5, 9]) {
      const offs = spiderfyOffsets(n);
      expect(offs).toHaveLength(n);
      const radien = offs.map((o) => Math.hypot(o.x, o.y));
      const r0 = radien[0];
      for (const r of radien) expect(Math.abs(r - r0)).toBeLessThan(0.001); // exakter Kreis
      expect(minAbstand(offs)).toBeGreaterThanOrEqual(34);
    }
  });

  it('ab 10: Spirale — count stimmt, kein Overlap (≥ Icon-Größe), Radius wächst', () => {
    const offs = spiderfyOffsets(20);
    expect(offs).toHaveLength(20);
    expect(minAbstand(offs)).toBeGreaterThanOrEqual(34);
    const radien = offs.map((o) => Math.hypot(o.x, o.y));
    expect(radien[radien.length - 1]).toBeGreaterThan(radien[0]); // nach außen wachsend
  });

  it('ist deterministisch (gleicher Input → identischer Output)', () => {
    expect(spiderfyOffsets(13)).toEqual(spiderfyOffsets(13));
  });
});
