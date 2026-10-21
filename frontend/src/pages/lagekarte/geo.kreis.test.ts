import { describe, expect, it } from 'vitest';
import {
  abstandM,
  formatRadius,
  KREIS_ECKEN,
  kreisAusZone,
  kreisPolygon,
  polygonFlaecheM2,
  radiusPunkt,
} from './geo';

/**
 * Kreis um einen Punkt (LLH-1043, design.md D1/D2): die Vorschau rechnet dieselbe Näherung wie der
 * Server (`lage_zone::kreis_polygon`) — 64 Ecken auf der Kugel, Ring gegen den Uhrzeigersinn.
 */
describe('kreisPolygon', () => {
  it.each([
    [54, 9.5, 300],
    [54, 9.5, 50],
    [54, 9.5, 50_000],
    [51.3, 9.9, 1_000],
  ])('weicht bei %s° N höchstens 1 % vom Sollradius ab (r = %s m)', (lat, lon, r) => {
    const poly = kreisPolygon({ lat, lon }, r);
    const ring = poly.coordinates[0];
    expect(ring).toHaveLength(KREIS_ECKEN + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [x, y] of ring) {
      expect(Math.abs(abstandM({ lat, lon }, { lat: y, lon: x }) - r) / r).toBeLessThanOrEqual(
        0.01,
      );
    }
    const soll = Math.PI * r * r;
    expect(Math.abs(polygonFlaecheM2(poly) - soll) / soll).toBeLessThanOrEqual(0.01);
  });

  it('läuft gegen den Uhrzeigersinn (RFC 7946)', () => {
    const ring = kreisPolygon({ lat: 54, lon: 9.5 }, 300).coordinates[0];
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++)
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    expect(a).toBeGreaterThan(0);
  });
});

describe('radiusPunkt und abstandM', () => {
  it('der Griff liegt im Osten auf dem Rand', () => {
    const mitte = { lat: 54, lon: 9.5 };
    const p = radiusPunkt(mitte, 300);
    expect(p.lat).toBeCloseTo(54, 3);
    expect(p.lon).toBeGreaterThan(9.5);
    expect(abstandM(mitte, p)).toBeCloseTo(300, 3);
  });
});

describe('formatRadius', () => {
  it('ganze Meter mit Tausenderpunkt, wie der ETB-Wortlaut des Servers', () => {
    expect(formatRadius(300)).toBe('300 m');
    expect(formatRadius(1_500)).toBe('1.500 m');
    expect(formatRadius(50_000)).toBe('50.000 m');
    expect(formatRadius(299.6)).toBe('300 m');
  });
});

describe('kreisAusZone', () => {
  it('nur mit allen drei Angaben ist es ein Kreis', () => {
    expect(
      kreisAusZone({ kreis_mitte_lat: 54, kreis_mitte_lon: 9.5, kreis_radius_m: 300 }),
    ).toEqual({ mitte: { lat: 54, lon: 9.5 }, radiusM: 300 });
    expect(kreisAusZone({ kreis_mitte_lat: 54, kreis_mitte_lon: 9.5 })).toBeNull();
    expect(kreisAusZone({})).toBeNull();
  });
});
