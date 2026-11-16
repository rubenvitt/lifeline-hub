import { theme } from 'antd';
import { describe, expect, it } from 'vitest';
import type { LagemonitorAbschnitt, LagemonitorZone } from '../api/types';
import { rollenFarbe } from '../theme/statusFarben';
import {
  baueMonitorFlaechen,
  belegungText,
  istUeberbelegt,
  zonenMarkenText,
} from './lagemonitorFlaechen';
import { monitorAusschnitt } from './LagemonitorKarte';

const token = theme.getDesignToken();

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
  it('zeichnet Gefahrenzonen im Stil der Lagekarte; die Ebene trägt keine Beschriftung', () => {
    const zonen: LagemonitorZone[] = [
      { id: 1, typ: 'absperrbereich', geometrie: POLY },
      { id: 2, typ: 'gefahrengebiet', geometrie: POLY },
      { id: 3, typ: 'absperrgrenze', geometrie: LINIE },
    ];
    const { zonen: fc } = baueMonitorFlaechen(zonen, [], token);
    expect(fc.features.map((f) => f.id)).toEqual([1, 2, 3]);
    // Die Beschriftung steht als Marke in Großbild-Schrift, nicht in der 10-px-Ebene der Lagekarte.
    expect(fc.features.every((f) => f.properties.label === '')).toBe(true);
    expect(fc.features[0].properties.fillColor).toBe('#fa8c16');
    expect(fc.features[1].properties.gestrichelt).toBe(true);
    expect(fc.features[2].geometry.type).toBe('LineString');
  });

  it('färbt ein Gefahrengebiet nach seiner Warnstufe wie die Lagekarte (LLH-1746)', () => {
    const gebiet = (warnstufe: 'mittel' | 'hoch') => ({
      bezeichnung: 'Hangrutsch',
      warnstufe,
      bestaetigt: true,
    });
    const { zonen: fc } = baueMonitorFlaechen(
      [
        { id: 1, typ: 'gefahrengebiet', geometrie: POLY, gebiet: gebiet('hoch') },
        { id: 2, typ: 'gefahrengebiet', geometrie: POLY, gebiet: gebiet('mittel') },
        { id: 3, typ: 'gefahrengebiet', geometrie: POLY },
      ],
      [],
      token,
    );
    expect(fc.features[0].properties.fillColor).toBe(rollenFarbe('alarm', token));
    expect(fc.features[1].properties.fillColor).toBe(rollenFarbe('achtung', token));
    // Ohne Gebiet keine Stufe: der feste Stil des Typs, wie auf der Lagekarte.
    expect(fc.features[2].properties.fillColor).toBe('#cf1322');
    expect(fc.features.every((f) => f.properties.gestrichelt)).toBe(true);
  });

  it('setzt je Gefahrenzone eine Marke mit Text und Rolle der Stufe (LLH-1746)', () => {
    const { zonenMarken } = baueMonitorFlaechen(
      [
        {
          id: 1,
          typ: 'gefahrengebiet',
          geometrie: POLY,
          gebiet: { bezeichnung: 'Hangrutsch Kirchberg', warnstufe: 'hoch', bestaetigt: true },
        },
        {
          id: 2,
          typ: 'gefahrengebiet',
          geometrie: POLY,
          gebiet: { bezeichnung: 'Hangrutsch Kirchberg', warnstufe: 'niedrig', bestaetigt: false },
        },
        { id: 3, typ: 'absperrgrenze', geometrie: LINIE },
        { id: 4, typ: 'sperrgebiet', geometrie: 'kaputt' },
      ],
      [],
      token,
    );
    expect(zonenMarken.map((m) => [m.id, m.text, m.rolle])).toEqual([
      [1, 'Hangrutsch Kirchberg · hoch', 'alarm'],
      [2, 'Hangrutsch Kirchberg · niedrig · unbestätigt', 'achtung'],
      [3, 'Absperrgrenze', null],
    ]);
    // Fläche: am Schwerpunkt; Linie: in der Mitte zwischen ihren mittleren Stützpunkten.
    expect(zonenMarken[0].lon).toBeGreaterThan(10.24);
    expect(zonenMarken[0].lon).toBeLessThan(10.25);
    expect(zonenMarken[0].lat).toBeGreaterThan(50.95);
    expect(zonenMarken[2].lon).toBeCloseTo(10.305);
    expect(zonenMarken[2].lat).toBeCloseTo(50.905);
  });

  it('beschriftet Abschnittsflächen mit der Kurzbezeichnung, sonst der Bezeichnung', () => {
    const abschnitte: LagemonitorAbschnitt[] = [
      { id: 7, bezeichnung: 'EA Nord', kurzbezeichnung: 'EA-N', flaeche_geojson: POLY },
      { id: 8, bezeichnung: 'EA Süd', kurzbezeichnung: null, flaeche_geojson: POLY },
    ];
    const { abschnitte: fc, marken } = baueMonitorFlaechen([], abschnitte, token);
    expect(fc.features.map((f) => f.properties.label)).toEqual(['EA-N', 'EA Süd']);
    expect(marken.map((m) => m.text)).toEqual(['EA-N', 'EA Süd']);
    expect(marken[0].lon).toBeGreaterThan(10.24);
    expect(marken[0].lat).toBeLessThan(50.96);
  });

  it('lässt unlesbare Geometrien weg', () => {
    const { zonen, abschnitte, stuetzpunkte } = baueMonitorFlaechen(
      [{ id: 1, typ: 'sperrgebiet', geometrie: 'kaputt' }],
      [{ id: 2, bezeichnung: 'EA', kurzbezeichnung: null, flaeche_geojson: LINIE }],
      token,
    );
    expect(zonen.features).toEqual([]);
    expect(abschnitte.features).toEqual([]);
    expect(stuetzpunkte).toEqual([]);
  });

  it('nimmt jeden Stützpunkt in den Ausschnitt auf', () => {
    const { stuetzpunkte } = baueMonitorFlaechen(
      [{ id: 3, typ: 'absperrgrenze', geometrie: LINIE }],
      [{ id: 2, bezeichnung: 'EA', kurzbezeichnung: null, flaeche_geojson: POLY }],
      token,
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

describe('zonenMarkenText (Spec `lagemonitor`, „Gefahrenzonen mit Name und Warnstufe“)', () => {
  const zone = (z: Partial<LagemonitorZone>): LagemonitorZone => ({
    id: 1,
    typ: 'gefahrengebiet',
    geometrie: POLY,
    ...z,
  });
  it('Gefahrengebiet: Bezeichnung des Gebiets und Stufe, offen mit „unbestätigt“', () => {
    expect(
      zonenMarkenText(
        zone({
          gebiet: { bezeichnung: 'Hangrutsch Kirchberg', warnstufe: 'hoch', bestaetigt: true },
        }),
      ),
    ).toBe('Hangrutsch Kirchberg · hoch');
    expect(
      zonenMarkenText(
        zone({
          gebiet: { bezeichnung: 'Hangrutsch Kirchberg', warnstufe: 'mittel', bestaetigt: false },
        }),
      ),
    ).toBe('Hangrutsch Kirchberg · mittel · unbestätigt');
  });
  it('ohne Bezeichnung „Gefahrengebiet“, ohne Gebiet ohne Stufe', () => {
    expect(
      zonenMarkenText(zone({ gebiet: { bezeichnung: '  ', warnstufe: 'akut', bestaetigt: true } })),
    ).toBe('Gefahrengebiet · akut');
    expect(
      zonenMarkenText(
        zone({ gebiet: { bezeichnung: null, warnstufe: 'keine', bestaetigt: true } }),
      ),
    ).toBe('Gefahrengebiet · keine Stufe');
    expect(zonenMarkenText(zone({}))).toBe('Gefahrengebiet');
  });
  it('Absperrung und Sperrgebiet: nur das Artwort', () => {
    expect(zonenMarkenText(zone({ typ: 'absperrbereich' }))).toBe('Absperrbereich');
    expect(zonenMarkenText(zone({ typ: 'absperrgrenze' }))).toBe('Absperrgrenze');
    expect(zonenMarkenText(zone({ typ: 'sperrgebiet' }))).toBe('Sperrgebiet');
  });
});

describe('istUeberbelegt und belegungText (LLH-1746)', () => {
  it('nur mehr Belegte als Plätze ist überbelegt', () => {
    expect(istUeberbelegt({ belegt: 8, plaetze: 5 })).toBe(true);
    expect(istUeberbelegt({ belegt: 5, plaetze: 5 })).toBe(false);
    expect(istUeberbelegt({ belegt: 2, plaetze: 0 })).toBe(false);
  });
  it('„8/5“, ohne Plätze nur die Belegten', () => {
    expect(belegungText({ belegt: 8, plaetze: 5 })).toBe('8/5');
    expect(belegungText({ belegt: 2, plaetze: 0 })).toBe('2');
  });
});
