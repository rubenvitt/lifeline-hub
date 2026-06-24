import { describe, it, expect, vi } from 'vitest';
import { sorgeFuerBildLayer, entferneBildLayer, synchronisiereBildLayer, bildSourceId, bildLayerId } from './bildLayer';
import type { Ecken } from '../../api/kartenbilder';

const ECKEN: Ecken = [[9,50],[9.1,50],[9.1,49.9],[9,49.9]];

function fakeMap() {
  const sources = new Map<string, { setCoordinates: ReturnType<typeof vi.fn> }>();
  const layers = new Set<string>();
  const paint: Record<string, Record<string, unknown>> = {};
  return {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string) => sources.set(id, { setCoordinates: vi.fn() })),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((l: { id: string }) => layers.add(l.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    setPaintProperty: vi.fn((lid: string, prop: string, val: unknown) => {
      (paint[lid] ??= {})[prop] = val;
    }),
    _sources: sources, _layers: layers, _paint: paint,
  };
}

describe('bildLayer', () => {
  it('legt image source + raster layer idempotent an', () => {
    const map = fakeMap();
    const ov = { id: 3, blobUrl: 'blob:x', ecken: ECKEN, opazitaet: 80, sichtbar: true };
    sorgeFuerBildLayer(map as never, ov);
    sorgeFuerBildLayer(map as never, ov); // zweimal → kein zweites add
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map._layers.has(bildLayerId(3))).toBe(true);
  });

  it('opazitaet*sichtbar steuert raster-opacity', () => {
    const map = fakeMap();
    sorgeFuerBildLayer(map as never, { id: 3, blobUrl: 'blob:x', ecken: ECKEN, opazitaet: 50, sichtbar: false });
    // unsichtbar → 0, egal welche opazitaet
    expect(map._paint[bildLayerId(3)]['raster-opacity']).toBe(0);
  });

  it('entferneBildLayer entfernt layer und source', () => {
    const map = fakeMap();
    sorgeFuerBildLayer(map as never, { id: 5, blobUrl: 'blob:y', ecken: ECKEN, opazitaet: 100, sichtbar: true });
    expect(map._layers.has(bildLayerId(5))).toBe(true);
    entferneBildLayer(map as never, 5);
    expect(map._layers.has(bildLayerId(5))).toBe(false);
    expect(map._sources.has(bildSourceId(5))).toBe(false);
  });

  it('synchronisiere entfernt nicht mehr vorhandene', () => {
    const map = fakeMap();
    synchronisiereBildLayer(map as never, [{ id: 1, blobUrl: 'b', ecken: ECKEN, opazitaet: 100, sichtbar: true }]);
    expect(map._layers.has(bildLayerId(1))).toBe(true);
    synchronisiereBildLayer(map as never, []); // jetzt leer
    expect(map._layers.has(bildLayerId(1))).toBe(false);
    expect(map._sources.has(bildSourceId(1))).toBe(false);
  });
});
