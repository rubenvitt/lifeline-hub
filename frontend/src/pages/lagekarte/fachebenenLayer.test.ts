import { describe, it, expect, vi } from 'vitest';
import {
  sorgeFuerFachebeneLayer,
  entferneFachebeneLayer,
  fachebeneSourceId,
  fachebeneClickLayerId,
  kategorieLabel,
} from './fachebenenLayer';
import { FACHEBENEN } from './fachebenen';

function fakeMap() {
  const sources = new Set<string>();
  const layers = new Set<string>();
  return {
    getSource: vi.fn((id: string) => (sources.has(id) ? {} : undefined)),
    addSource: vi.fn((id: string) => sources.add(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((l: { id: string }) => layers.add(l.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    _sources: sources,
    _layers: layers,
  };
}

const leer = { type: 'FeatureCollection', features: [] } as const;

describe('fachebenenLayer', () => {
  it('legt Source + Polygon-Layer für DWD an (idempotent)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(true);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(true);
    expect(m._layers.has('fachebene-dwd-line')).toBe(true);
    // nur einmal angelegt
    expect(m.addSource).toHaveBeenCalledTimes(1);
  });

  it('legt Circle-Layer für Punkt-Ebene (pegelonline) an', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.pegelonline, leer as never);
    expect(m._layers.has('fachebene-pegelonline-circle')).toBe(true);
  });

  it('entfernt Layer + Source', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    entferneFachebeneLayer(m as never, 'dwd');
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(false);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(false);
  });
});

describe('fachebeneClickLayerId', () => {
  it('Polygon-Ebene → fill-Layer, Punkt-Ebene → circle-Layer', () => {
    expect(fachebeneClickLayerId(FACHEBENEN.dwd)).toBe('fachebene-dwd-fill');
    expect(fachebeneClickLayerId(FACHEBENEN.pegelonline)).toBe('fachebene-pegelonline-circle');
  });
});

describe('kategorieLabel', () => {
  it('mappt bekannte Kategorien, Fallback auf Rohwert', () => {
    expect(kategorieLabel('krankenhaus')).toBe('Krankenhaus');
    expect(kategorieLabel('strom')).toBe('Umspannwerk');
    expect(kategorieLabel('unbekannt')).toBe('unbekannt');
  });
});

