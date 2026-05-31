import { describe, expect, it } from 'vitest';
import { polygonZentroid } from './geo';

describe('polygonZentroid', () => {
  it('Mittelpunkt eines Quadrats', () => {
    const gj = { type: 'Polygon' as const, coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] };
    const [lon, lat] = polygonZentroid(gj)!;
    expect(lon).toBeCloseTo(1, 6);
    expect(lat).toBeCloseTo(1, 6);
  });
  it('ungültig → null', () => {
    expect(polygonZentroid({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
});
