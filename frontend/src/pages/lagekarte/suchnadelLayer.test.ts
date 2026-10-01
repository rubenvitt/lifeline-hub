import { describe, expect, it, vi } from 'vitest';
import { ordneKlickebene } from './klickziel';
import {
  SUCHNADEL_LAYER,
  SUCHNADEL_QUELLE,
  sorgeFuerSuchnadelLayer,
  suchnadelFc,
} from './suchnadelLayer';

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
    moveLayer: vi.fn((...args: [id: string, vor?: string]) => moves.push(args[0])),
  };
  return { map, quellen, layers, moves };
}

const ORT = { lat: 51.16, lon: 10.45, beschriftung: 'Hauptstraße 12', art: 'adresse' as const };

describe('suchnadelFc (LFH-638)', () => {
  it('ohne Ort leer, mit Ort ein Punkt in [lon, lat]', () => {
    expect(suchnadelFc(null).features).toHaveLength(0);
    const fc = suchnadelFc(ORT);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [10.45, 51.16] });
  });
});

describe('sorgeFuerSuchnadelLayer (LFH-638)', () => {
  it('legt ohne je gesetzte Nadel nichts an', () => {
    const { map } = fakeMap();
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(null), '#1677ff');
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('legt Quelle und Layer einmal an und zieht sie nach oben', () => {
    const { map, layers, moves } = fakeMap();
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(ORT), '#1677ff');
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(ORT), '#1677ff');
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addSource.mock.calls[0][0]).toBe(SUCHNADEL_QUELLE);
    expect([...layers.keys()]).toEqual([...SUCHNADEL_LAYER]);
    expect(moves.slice(-SUCHNADEL_LAYER.length)).toEqual([...SUCHNADEL_LAYER]);
  });

  it('bleibt unter einer schon liegenden Eigenposition', () => {
    const { map, layers } = fakeMap();
    layers.set('eigenposition-kreis', { id: 'eigenposition-kreis' });
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(ORT), '#1677ff');
    for (const id of SUCHNADEL_LAYER) {
      expect(map.moveLayer).toHaveBeenCalledWith(id, 'eigenposition-kreis');
    }
  });

  it('räumt per leerer Sammlung, statt die Ebene zu entfernen', () => {
    const { map, quellen } = fakeMap();
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(ORT), '#1677ff');
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(null), '#1677ff');
    expect(quellen.get(SUCHNADEL_QUELLE)?.setData).toHaveBeenLastCalledWith(suchnadelFc(null));
  });

  it('färbt beim Moduswechsel nach', () => {
    const { map } = fakeMap();
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(ORT), '#111111');
    sorgeFuerSuchnadelLayer(map as never, suchnadelFc(ORT), '#222222');
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'suchnadel-ring',
      'circle-stroke-color',
      '#222222',
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith('suchnadel-punkt', 'circle-color', '#222222');
  });
});

describe('Die Suchnadel ist kein Klickziel (LFH-638, Spec lagekarte-ortssuche)', () => {
  it('keine ihrer Ebenen hat eine Rolle in ordneKlickebene', () => {
    for (const id of SUCHNADEL_LAYER) expect(ordneKlickebene(id), id).toBeNull();
  });
});
