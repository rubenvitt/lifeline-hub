import { describe, expect, it, vi } from 'vitest';
import { ANFLUG_ZOOM, BEDIENUNG } from './kamera';
import { fokussiereRahmen, stelleKameraHer } from './fokusKamera';

describe('Fokus auf einen Abschnitt (LLH-1057)', () => {
  function kameraMap() {
    return {
      getCenter: vi.fn(() => ({ lng: 9.5, lat: 52.3 })),
      getZoom: vi.fn(() => 11),
      getBearing: vi.fn(() => 30),
      fitBounds: vi.fn(),
      easeTo: vi.fn(),
    };
  }

  it('passt auf den Rahmen ein, als Bedienung, und gibt die Kamera davor zurück', () => {
    const map = kameraMap();
    const vorher = fokussiereRahmen(map as never, [
      [9, 52],
      [9.1, 52.2],
    ]);
    expect(vorher).toEqual({ center: [9.5, 52.3], zoom: 11, bearing: 30 });
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [9, 52],
        [9.1, 52.2],
      ],
      // Die Drehung bleibt: ohne `bearing` nordete `fitBounds` die Karte, ungefragt.
      { padding: 48, maxZoom: ANFLUG_ZOOM, bearing: 30 },
      BEDIENUNG,
    );
  });

  it('fährt die Kamera davor wieder an, als Bedienung', () => {
    const map = kameraMap();
    stelleKameraHer(map as never, { center: [8, 50], zoom: 9, bearing: 0 });
    expect(map.easeTo).toHaveBeenCalledWith({ center: [8, 50], zoom: 9, bearing: 0 }, BEDIENUNG);
  });
});
