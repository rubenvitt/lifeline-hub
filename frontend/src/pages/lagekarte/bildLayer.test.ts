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

  it('erstanlage setzt raster-opacity=0 und raster-fade-duration=0 via addLayer-paint (unsichtbar)', () => {
    const map = fakeMap();
    sorgeFuerBildLayer(map as never, { id: 3, blobUrl: 'blob:x', ecken: ECKEN, opazitaet: 50, sichtbar: false });
    // unsichtbar → raster-opacity 0 im addLayer-paint
    const layerArg = map.addLayer.mock.calls[0][0] as { id: string; paint: Record<string, unknown> };
    expect(layerArg.paint['raster-opacity']).toBe(0);
    expect(layerArg.paint['raster-fade-duration']).toBe(0);
    // setPaintProperty darf beim Erstanlegen NICHT aufgerufen werden
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it('erstanlage setzt raster-opacity=0.8 via addLayer-paint (sichtbar, opazitaet:80)', () => {
    const map = fakeMap();
    sorgeFuerBildLayer(map as never, { id: 3, blobUrl: 'blob:x', ecken: ECKEN, opazitaet: 80, sichtbar: true });
    const layerArg = map.addLayer.mock.calls[0][0] as { id: string; paint: Record<string, unknown> };
    expect(layerArg.paint['raster-opacity']).toBe(0.8);
    expect(layerArg.paint['raster-fade-duration']).toBe(0);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it('update-pfad: zweiter Aufruf mit geänderter Opazität ruft setPaintProperty', () => {
    const map = fakeMap();
    const ov = { id: 3, blobUrl: 'blob:x', ecken: ECKEN, opazitaet: 80, sichtbar: true };
    sorgeFuerBildLayer(map as never, ov); // Erstanlage
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    // zweiter Aufruf mit anderer Opazität → Update-Pfad
    sorgeFuerBildLayer(map as never, { ...ov, opazitaet: 40 });
    expect(map.setPaintProperty).toHaveBeenCalledWith(bildLayerId(3), 'raster-opacity', 0.4);
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
