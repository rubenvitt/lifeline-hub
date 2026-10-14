import { describe, expect, it } from 'vitest';
import type { LagemonitorAbschnitt, LagemonitorZone } from '../api/types';
import { baueMonitorFlaechen } from './lagemonitorFlaechen';
import { monitorAusschnitt } from './LagemonitorKarte';

const RING = [
  [10.24, 50.95],
  [10.25, 50.95],
  [10.25, 50.96],
  [10.24, 50.95],
];
const POLY = JSON.stringify({ type: 'Polygon', coordinates: [RING] });
const LINIE = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [10.3, 50.9],
    [10.31, 50.91],
  ],
});

describe('baueMonitorFlaechen', () => {
  it('zeichnet Gefahrenzonen im Stil der Lagekarte, ohne Beschriftung', () => {
    const zonen: LagemonitorZone[] = [
      { id: 1, typ: 'absperrbereich', geometrie: POLY },
      { id: 2, typ: 'gefahrengebiet', geometrie: POLY },
      { id: 3, typ: 'absperrgrenze', geometrie: LINIE },
    ];
    const { zonen: fc } = baueMonitorFlaechen(zonen, []);
    expect(fc.features.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(fc.features.every((f) => f.properties.label === '')).toBe(true);
    expect(fc.features[0].properties.fillColor).toBe('#fa8c16');
    expect(fc.features[1].properties.gestrichelt).toBe(true);
    expect(fc.features[2].geometry.type).toBe('LineString');
  });

  it('beschriftet Abschnittsflächen mit der Kurzbezeichnung, sonst der Bezeichnung', () => {
    const abschnitte: LagemonitorAbschnitt[] = [
      { id: 7, bezeichnung: 'EA Nord', kurzbezeichnung: 'EA-N', flaeche_geojson: POLY },
      { id: 8, bezeichnung: 'EA Süd', kurzbezeichnung: null, flaeche_geojson: POLY },
    ];
    const { abschnitte: fc, marken } = baueMonitorFlaechen([], abschnitte);
    expect(fc.features.map((f) => f.properties.label)).toEqual(['EA-N', 'EA Süd']);
    expect(marken.map((m) => m.text)).toEqual(['EA-N', 'EA Süd']);
    expect(marken[0].lon).toBeGreaterThan(10.24);
    expect(marken[0].lat).toBeLessThan(50.96);
  });

  it('lässt unlesbare Geometrien weg', () => {
    const { zonen, abschnitte, stuetzpunkte } = baueMonitorFlaechen(
      [{ id: 1, typ: 'sperrgebiet', geometrie: 'kaputt' }],
      [{ id: 2, bezeichnung: 'EA', kurzbezeichnung: null, flaeche_geojson: LINIE }],
    );
    expect(zonen.features).toEqual([]);
    expect(abschnitte.features).toEqual([]);
    expect(stuetzpunkte).toEqual([]);
  });

  it('nimmt jeden Stützpunkt in den Ausschnitt auf', () => {
    const { stuetzpunkte } = baueMonitorFlaechen(
      [{ id: 3, typ: 'absperrgrenze', geometrie: LINIE }],
      [{ id: 2, bezeichnung: 'EA', kurzbezeichnung: null, flaeche_geojson: POLY }],
    );
    expect(monitorAusschnitt(stuetzpunkte)).toEqual({
      art: 'rahmen',
      west: 10.24,
      sued: 50.9,
      ost: 10.31,
      nord: 50.96,
    });
  });
});
