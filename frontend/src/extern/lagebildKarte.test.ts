import { describe, expect, it } from 'vitest';
import { lagebildKartenDaten } from './lagebildKarte';

/** Karte der Seite `/extern` (LLH-1496) als Eingaben der Monitorkarte. */
describe('lagebildKartenDaten', () => {
  it('ordnet Einsatzort, Zonen, Abschnitte und UHS zu, Zeichen und Unlesbares fallen weg', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [8.6, 50.1],
          [8.7, 50.1],
          [8.6, 50.1],
        ],
      ],
    };
    const daten = lagebildKartenDaten({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10.56, 52.96] },
          properties: { kind: 'einsatzort' },
        },
        {
          type: 'Feature',
          geometry: polygon,
          properties: { kind: 'zone', id: 3, typ: 'sperrgebiet' },
        },
        {
          type: 'Feature',
          geometry: polygon,
          properties: { kind: 'abschnitt', id: 4, bezeichnung: 'Nord', kurzbezeichnung: 'N' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10.5, 52.9] },
          properties: {
            kind: 'uhs',
            id: 5,
            bezeichnung: 'UHS 1',
            typ: 'behandlungsplatz',
            belegt: 3,
            plaetze: 8,
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10.4, 52.8] },
          properties: { kind: 'zeichen', id: 6, zeichen_spec: '{}' },
        },
        { type: 'Feature', geometry: null, properties: { kind: 'uhs', id: 7 } },
      ],
    });
    expect(daten.einsatzort).toEqual({ lat: 52.96, lon: 10.56 });
    expect(daten.zonen).toEqual([
      { id: 3, typ: 'sperrgebiet', geometrie: JSON.stringify(polygon) },
    ]);
    expect(daten.abschnitte).toEqual([
      {
        id: 4,
        bezeichnung: 'Nord',
        kurzbezeichnung: 'N',
        flaeche_geojson: JSON.stringify(polygon),
      },
    ]);
    expect(daten.uhs).toHaveLength(1);
    expect(daten.uhs[0]).toMatchObject({
      id: 5,
      bezeichnung: 'UHS 1',
      belegt: 3,
      plaetze: 8,
      lat: 52.9,
      lon: 10.5,
    });
  });

  it('ohne Karte bleibt alles leer', () => {
    expect(lagebildKartenDaten(undefined)).toEqual({
      einsatzort: null,
      uhs: [],
      zonen: [],
      abschnitte: [],
    });
  });
});
