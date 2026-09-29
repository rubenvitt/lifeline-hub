import { describe, expect, it, vi } from 'vitest';
import {
  EIGENPOSITION_LAYER,
  EIGENPOSITION_QUELLE,
  eigenpositionFc,
  genauigkeitsKreis,
  sorgeFuerEigenpositionLayer,
} from './eigenpositionLayer';

/** Haversine — unabhängig vom Rechenweg der Kreisfunktion, sonst prüfte sie sich selbst. */
function abstandM([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const r = (g: number) => (g * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(a));
}

describe('genauigkeitsKreis (LFH-712)', () => {
  it.each([
    ['Äquator', 0, 0],
    ['51° N', 51.3, 9.5],
  ])('hält den Radius auf ±1 % in alle Richtungen (%s)', (_n, lat, lon) => {
    const ring = genauigkeitsKreis(lat, lon, 250);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const p of ring) {
      const d = abstandM([lon, lat], p);
      expect(Math.abs(d - 250) / 250).toBeLessThan(0.01);
    }
  });
});

describe('eigenpositionFc (LFH-712)', () => {
  it('ohne Position leer, mit Position Kreis und Punkt', () => {
    expect(eigenpositionFc(null).features).toHaveLength(0);
    const fc = eigenpositionFc({ lat: 52, lon: 9, genauigkeit: 30 });
    expect(fc.features.map((f) => f.geometry.type)).toEqual(['Polygon', 'Point']);
    expect(fc.features[1].geometry.coordinates).toEqual([9, 52]);
  });
});

function fakeMap() {
  const quellen = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, Record<string, unknown>>();
  const moves: string[] = [];
  const map = {
    getSource: (id: string) => quellen.get(id),
    addSource: vi.fn((id: string) => quellen.set(id, { setData: vi.fn() })),
    getLayer: (id: string) => layers.get(id),
    addLayer: vi.fn((l: Record<string, unknown>) => layers.set(l.id as string, l)),
    setPaintProperty: vi.fn(),
    moveLayer: vi.fn((id: string) => moves.push(id)),
  };
  return { map, quellen, layers, moves };
}

describe('sorgeFuerEigenpositionLayer (LFH-712)', () => {
  it('legt ohne je gemeldete Position nichts an', () => {
    const { map } = fakeMap();
    sorgeFuerEigenpositionLayer(map as never, eigenpositionFc(null), '#1677ff');
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('legt Quelle und vier Layer einmal an und zieht sie nach oben', () => {
    const { map, layers, moves } = fakeMap();
    const pos = eigenpositionFc({ lat: 52, lon: 9, genauigkeit: 30 });
    sorgeFuerEigenpositionLayer(map as never, pos, '#1677ff');
    sorgeFuerEigenpositionLayer(map as never, pos, '#1677ff');
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addSource.mock.calls[0][0]).toBe(EIGENPOSITION_QUELLE);
    expect([...layers.keys()]).toEqual([...EIGENPOSITION_LAYER]);
    // Punkt zuletzt = oben, Kante direkt darunter.
    expect(moves.slice(-2)).toEqual(['eigenposition-kante', 'eigenposition-punkt']);
  });

  it('spielt neue Daten per setData ein und färbt beim Moduswechsel nach', () => {
    const { map, quellen } = fakeMap();
    sorgeFuerEigenpositionLayer(
      map as never,
      eigenpositionFc({ lat: 51, lon: 9, genauigkeit: 10 }),
      '#111111',
    );
    const daten = eigenpositionFc({ lat: 52, lon: 9, genauigkeit: 30 });
    sorgeFuerEigenpositionLayer(map as never, daten, '#222222');
    expect(quellen.get(EIGENPOSITION_QUELLE)?.setData).toHaveBeenCalledWith(daten);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'eigenposition-punkt',
      'circle-color',
      '#222222',
    );
  });
});
