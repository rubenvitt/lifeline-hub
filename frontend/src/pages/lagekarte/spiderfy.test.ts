import { describe, it, expect } from 'vitest';
import { spiderfyOffsets, baueSpiderFc, SPIDER_LEAF_ABSTAND } from './spiderfy';
import type { MarkerProps } from './markerLayer';

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

// Identitäts-Projektor: Pixel == Lng/Lat → Offsets erscheinen unverändert in den Koordinaten.
const idProjektor = {
  project: (ll: [number, number]) => ({ x: ll[0], y: ll[1] }),
  unproject: (px: { x: number; y: number }) => ({ lng: px.x, lat: px.y }),
};

const props = (schluessel: string, extra: Partial<MarkerProps> = {}): MarkerProps => ({
  schluessel, typ: 'uhs', farbe: '#000', ...extra,
});

describe('baueSpiderFc', () => {
  it('liefert je Leaf ein Feature mit unveränderten Properties + ein Beinchen vom Anker', () => {
    const leaves = [props('uhs-1'), props('fahrzeug-2', { icon: 'tz|x', statusFarbe: '#0f0' })];
    const { leaves: leafFc, legs } = baueSpiderFc(leaves, [100, 100], idProjektor);

    expect(leafFc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-1', 'fahrzeug-2']);
    expect(leafFc.features[1].properties.icon).toBe('tz|x');
    expect(leafFc.features[1].properties.statusFarbe).toBe('#0f0');
    // Position = Anker + Offset (Identitäts-Projektor)
    expect(leafFc.features).toHaveLength(2);
    expect(legs.features).toHaveLength(2);
    for (const leg of legs.features) {
      expect(leg.geometry.coordinates[0]).toEqual([100, 100]); // Beinchen startet am Anker
    }
    // Beinchen-Ende == zugehörige Leaf-Position
    expect(legs.features[0].geometry.coordinates[1]).toEqual(leafFc.features[0].geometry.coordinates);
  });

  it('ist leer bei keinen Leaves', () => {
    const { leaves, legs } = baueSpiderFc([], [0, 0], idProjektor);
    expect(leaves.features).toHaveLength(0);
    expect(legs.features).toHaveLength(0);
  });
});
