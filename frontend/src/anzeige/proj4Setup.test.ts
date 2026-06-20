import { describe, it, expect } from 'vitest';
import proj4 from 'proj4';
import './proj4Setup';

describe('proj4Setup', () => {
  it('registriert GK Zone 3 (EPSG:31467) und transformiert Stuttgart', () => {
    expect(proj4.defs('EPSG:31467')).toBeTruthy();
    // Stuttgart lon=9.177 lat=48.782 → GK3 ~[3513083.5, 5404959.5] (towgs84-Helmert)
    const [r, h] = proj4('EPSG:4326', 'EPSG:31467', [9.177, 48.782]);
    expect(r).toBeCloseTo(3513083.5, 0);
    expect(h).toBeCloseTo(5404959.5, 0);
  });

  it('registriert alle vier GK-Zonen', () => {
    for (const epsg of ['EPSG:31466', 'EPSG:31467', 'EPSG:31468', 'EPSG:31469']) {
      expect(proj4.defs(epsg)).toBeTruthy();
    }
  });
});
