import { describe, expect, it, vi } from 'vitest';
import { eigenpositionRahmen } from './eigenpositionLayer';
import {
  ANFLUG_ZOOM,
  AUTOMATISCH,
  BEDIENUNG,
  fliegeEigenpositionAn,
  hoereAufBedienung,
  istBedienung,
} from './kamera';

/** Karte mit echtem Ereignisfluss: `fire` reicht `eventData` wie MapLibre in das Ereignis. */
function fakeMap() {
  const hoerer = new Map<string, Set<(e: unknown) => void>>();
  return {
    on: vi.fn((typ: string, f: (e: unknown) => void) => {
      if (!hoerer.has(typ)) hoerer.set(typ, new Set());
      hoerer.get(typ)!.add(f);
    }),
    off: vi.fn((typ: string, f: (e: unknown) => void) => hoerer.get(typ)?.delete(f)),
    fire(typ: string, eventData: object = {}) {
      for (const f of hoerer.get(typ) ?? []) f({ type: typ, ...eventData });
    },
    fitBounds: vi.fn(),
    getBearing: vi.fn(() => 0),
  };
}

describe('istBedienung (LFH-766, D2)', () => {
  it('Geste (originalEvent) und markierter Bedienweg zählen', () => {
    expect(istBedienung({ originalEvent: new Event('pointerdown') })).toBe(true);
    expect(istBedienung({ ...BEDIENUNG })).toBe(true);
  });

  it('automatische Bewegungen zählen nicht', () => {
    // `resize` aus MapLibres ResizeObserver trägt nichts, die Startansicht `AUTOMATISCH`.
    expect(istBedienung({})).toBe(false);
    expect(istBedienung({ ...AUTOMATISCH })).toBe(false);
  });
});

describe('hoereAufBedienung (LFH-766, D2)', () => {
  it('meldet nur bediente Bewegungsanfänge und räumt den Hörer', () => {
    const map = fakeMap();
    const melde = vi.fn();
    const aus = hoereAufBedienung(map as never, melde);
    map.fire('movestart'); // resize
    map.fire('movestart', AUTOMATISCH);
    expect(melde).not.toHaveBeenCalled();
    map.fire('movestart', BEDIENUNG);
    map.fire('movestart', { originalEvent: new Event('wheel') });
    expect(melde).toHaveBeenCalledTimes(2);
    aus();
    map.fire('movestart', BEDIENUNG);
    expect(melde).toHaveBeenCalledTimes(2);
  });
});

describe('fliegeEigenpositionAn (LFH-766, D1)', () => {
  it('rahmt den Genauigkeitskreis ein, höchstens bis zum Anflugzoom, als automatische Bewegung', () => {
    const map = fakeMap();
    const pos = { lat: 52.37, lon: 9.73, genauigkeit: 2000 };
    fliegeEigenpositionAn(map as never, pos);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    const [rahmen, optionen, eventData] = map.fitBounds.mock.calls[0];
    expect(rahmen).toEqual(eigenpositionRahmen(pos));
    expect(optionen).toMatchObject({ maxZoom: ANFLUG_ZOOM });
    expect(optionen.padding).toBeGreaterThan(0);
    // Der eigene Anflug ist keine Bedienung — sonst sperrte er sich selbst.
    expect(istBedienung(eventData ?? {})).toBe(false);
  });

  it('behält die Drehung der Karte (Pinch-Drehung bleibt erlaubt)', () => {
    const map = fakeMap();
    map.getBearing.mockReturnValue(37);
    fliegeEigenpositionAn(map as never, { lat: 52, lon: 9, genauigkeit: 500 });
    expect(map.fitBounds.mock.calls[0][1]).toMatchObject({ bearing: 37 });
  });

  it('der Anflugzoom bleibt der bisherige feste Zoom', () => {
    expect(ANFLUG_ZOOM).toBe(15);
  });
});
