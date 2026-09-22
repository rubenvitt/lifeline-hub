import { describe, expect, it } from 'vitest';
import { PUNKT_ZOOM, startAnsicht } from './startAnsicht';

const ort = { typ: 'einsatzort' as const, lat: 49.2, lon: 9.1 };
const uhs = { typ: 'uhs' as const, lat: 49.3, lon: 9.4 };
const schaden = { typ: 'schaden' as const, lat: 49.0, lon: 8.9 };

describe('startAnsicht', () => {
  it('nichts verortet → null (Karte bleibt auf der Übersicht)', () => {
    expect(startAnsicht([])).toBeNull();
    expect(startAnsicht([], { zoom: 12 })).toBeNull();
  });

  it('Zentrum der Ansicht geht vor, mit deren Zoom', () => {
    expect(startAnsicht([ort], { zentrum_lat: 50, zentrum_lon: 8, zoom: 11 })).toEqual({
      art: 'punkt',
      lng: 8,
      lat: 50,
      zoom: 11,
    });
  });

  it('halbes Ansichtszentrum zählt nicht — dann der Einsatzort', () => {
    expect(startAnsicht([uhs, ort], { zentrum_lat: 50, zentrum_lon: null })).toEqual({
      art: 'punkt',
      lng: 9.1,
      lat: 49.2,
      zoom: PUNKT_ZOOM,
    });
  });

  it('Einsatzort schlägt den Rahmen über alle Objekte, Zoom aus der Ansicht', () => {
    expect(startAnsicht([uhs, schaden, ort], { zoom: 12 })).toEqual({
      art: 'punkt',
      lng: 9.1,
      lat: 49.2,
      zoom: 12,
    });
  });

  it('ohne Einsatzort: ein Objekt → Punkt, mehrere → Rahmen', () => {
    expect(startAnsicht([uhs])).toEqual({ art: 'punkt', lng: 9.4, lat: 49.3, zoom: PUNKT_ZOOM });
    expect(startAnsicht([uhs, schaden])).toEqual({
      art: 'rahmen',
      west: 8.9,
      sued: 49.0,
      ost: 9.4,
      nord: 49.3,
    });
  });

  it('deckungsgleiche Objekte ergeben einen Punkt, keinen leeren Rahmen', () => {
    expect(startAnsicht([uhs, { ...uhs, typ: 'schaden' }])).toEqual({
      art: 'punkt',
      lng: 9.4,
      lat: 49.3,
      zoom: PUNKT_ZOOM,
    });
  });

  it('ungültige Koordinaten fallen heraus', () => {
    expect(startAnsicht([{ typ: 'uhs', lat: Number.NaN, lon: 9 }, schaden])).toEqual({
      art: 'punkt',
      lng: 8.9,
      lat: 49.0,
      zoom: PUNKT_ZOOM,
    });
    expect(startAnsicht([{ typ: 'einsatzort', lat: 120, lon: 9 }])).toBeNull();
  });
});
