import type { Drawing } from '@einsatzzeichen/schema';
import { describe, expect, it } from 'vitest';
import type { ExportObjekt } from './geoExport';
import { writeGeojson } from './geojsonWriter';

const META = { stand: new Date('2026-11-24T09:05:07Z'), einsatzName: 'Hochwasser Nord' };

const OFFENER_RING: number[][][] = [
  [
    [9.1, 54.1],
    [9.2, 54.1],
    [9.2, 54.2],
  ],
];

function punkt(teil: Partial<ExportObjekt> = {}): ExportObjekt {
  return {
    art: 'einheit',
    name: 'Trupp 1',
    beschriftung: 'Trupp 1',
    geometrie: { type: 'Point', coordinates: [9.5, 54.5] },
    stil: { markerFarbe: '#1677ff' },
    ...teil,
  };
}

function flaeche(teil: Partial<ExportObjekt> = {}): ExportObjekt {
  return {
    art: 'zone',
    name: 'Sperrzone',
    beschriftung: 'Sperrzone',
    geometrie: { type: 'Polygon', coordinates: OFFENER_RING },
    stil: { linie: '#ff0000', fuellung: '#00ff00', deckkraft: 0.25, breite: 3 },
    ...teil,
  };
}

function lies(objekte: ExportObjekt[]) {
  return JSON.parse(writeGeojson(objekte, META)) as {
    type: string;
    crs?: unknown;
    'lfh:stand': string;
    'lfh:quelle': string;
    features: {
      type: string;
      geometry: { type: string; coordinates: unknown };
      properties: Record<string, unknown>;
    }[];
  };
}

describe('writeGeojson', () => {
  it('schreibt eine FeatureCollection mit Stand in UTC, Quelle und ohne crs', () => {
    const fc = lies([punkt()]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc['lfh:stand']).toBe('2026-11-24 09:05:07');
    expect(fc['lfh:quelle']).toBe('Lifeline Hub');
    expect('crs' in fc).toBe(false);
  });

  it('gibt jedem Feature name und lfh:art, das Zeichen nur wenn vorhanden', () => {
    const mitZeichen = punkt({
      zeichen: { schluessel: 'ez|abc', spec: 'abc', drawing: {} as Drawing },
    });
    const fc = lies([mitZeichen, flaeche()]);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].type).toBe('Feature');
    expect(fc.features[0].properties.name).toBe('Trupp 1');
    expect(fc.features[0].properties['lfh:art']).toBe('einheit');
    expect(fc.features[0].properties['lfh:zeichen']).toBe('abc');
    expect(fc.features[1].properties.name).toBe('Sperrzone');
    expect(fc.features[1].properties['lfh:art']).toBe('zone');
    expect('lfh:zeichen' in fc.features[1].properties).toBe(false);
  });

  it('setzt simplestyle für Flächen und marker-color für Punkte', () => {
    const [p, f] = lies([punkt(), flaeche()]).features;
    expect(p.properties['marker-color']).toBe('#1677ff');
    expect('fill' in p.properties).toBe(false);
    expect(f.properties.stroke).toBe('#ff0000');
    expect(f.properties['stroke-width']).toBe(3);
    expect(f.properties.fill).toBe('#00ff00');
    expect(f.properties['fill-opacity']).toBe(0.25);
    expect('marker-color' in f.properties).toBe(false);
  });

  it('schließt Polygonringe', () => {
    const ring = lies([flaeche()]).features[0].geometry.coordinates as number[][][];
    expect(ring[0]).toHaveLength(4);
    expect(ring[0][0]).toEqual(ring[0][ring[0].length - 1]);
  });

  it('lässt einen schon geschlossenen Ring unverändert', () => {
    const zu = [...OFFENER_RING[0], OFFENER_RING[0][0]];
    const ring = lies([flaeche({ geometrie: { type: 'Polygon', coordinates: [zu] } })]).features[0]
      .geometry.coordinates as number[][][];
    expect(ring[0]).toEqual(zu);
  });

  it('schreibt Warnstufe und Kreis des Gefahrengebiets', () => {
    const g = flaeche({
      art: 'gefahrengebiet',
      name: 'Werk',
      warnstufe: 'hoch',
      kreis: { mitte: [9.15, 54.15], radius_m: 300 },
    });
    const props = lies([g]).features[0].properties;
    expect(props['lfh:warnstufe']).toBe('hoch');
    expect(props['lfh:kreis']).toEqual({ mitte: [9.15, 54.15], radius_m: 300 });
    expect('lfh:warnstufe' in lies([flaeche()]).features[0].properties).toBe(false);
  });
});
