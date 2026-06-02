import { describe, expect, it } from 'vitest';
import { polygonZentroid, parseGeometry } from './geo';

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

describe('parseGeometry', () => {
  it('liest ein Polygon', () => {
    const g = parseGeometry('{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}');
    expect(g?.type).toBe('Polygon');
  });
  it('liest einen LineString', () => {
    const g = parseGeometry('{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}');
    expect(g?.type).toBe('LineString');
  });
  it('gibt null bei Unsinn / fremdem Typ zurück', () => {
    expect(parseGeometry('{"type":"Point","coordinates":[8.6,50.1]}')).toBeNull();
    expect(parseGeometry('kein json')).toBeNull();
    expect(parseGeometry(null)).toBeNull();
  });
});
