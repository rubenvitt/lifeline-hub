import { describe, it, expect, vi } from 'vitest';
import {
  copernicusBildAnker,
  copernicusBildLayerId,
  copernicusBildSourceId,
  synchronisiereCopernicusBilder,
} from './copernicusBildLayer';
import { FACHEBENEN, type CopernicusBild } from './fachebenen';
import { fachebeneClickLayerIds } from './fachebenenLayer';

/** Karte mit geordneter Layerliste: `addLayer`/`moveLayer` mit `beforeId` wie MapLibre. */
function fakeMap(start: string[] = []) {
  const quellen = new Map<string, unknown>();
  const layer: { id: string; paint?: Record<string, unknown> }[] = start.map((id) => ({ id }));
  const index = (id: string) => layer.findIndex((l) => l.id === id);
  const einfuegen = (l: { id: string }, vor?: string) => {
    const i = vor === undefined ? -1 : index(vor);
    if (i < 0) layer.push(l);
    else layer.splice(i, 0, l);
  };
  return {
    getSource: vi.fn((id: string) => quellen.get(id)),
    addSource: vi.fn((id: string, q: unknown) => quellen.set(id, q)),
    removeSource: vi.fn((id: string) => quellen.delete(id)),
    getLayer: vi.fn((id: string) => layer.find((l) => l.id === id)),
    addLayer: vi.fn((l: { id: string }, vor?: string) => einfuegen(l, vor)),
    moveLayer: vi.fn((id: string, vor?: string) => {
      const [l] = layer.splice(index(id), 1);
      einfuegen(l, vor);
    }),
    removeLayer: vi.fn((id: string) => layer.splice(index(id), 1)),
    setPaintProperty: vi.fn((id: string, prop: string, wert: unknown) => {
      const l = layer.find((x) => x.id === id)!;
      (l.paint ??= {})[prop] = wert;
    }),
    getStyle: vi.fn(() => ({ layers: layer.map((l) => ({ id: l.id })) })),
    _quellen: quellen,
    _ids: () => layer.map((l) => l.id),
    _layer: (id: string) => layer.find((l) => l.id === id),
  };
}

const bild = (kennung: string, aufnahme: string, mehr: Partial<CopernicusBild> = {}) =>
  ({
    bild: kennung,
    emsr: 'EMSR728',
    gebiet: 'Bogen',
    sensor: 'Pleiades',
    aufnahme,
    minZoom: 10,
    maxZoom: 16,
    bounds: [12.6, 48.8, 12.7, 48.9],
    darstellbar: true,
    gekuerzt: false,
    ...mehr,
  }) satisfies CopernicusBild;

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

describe('copernicusBildLayer (LLH-2021)', () => {
  it('ist keine Klickebene', () => {
    expect(fachebeneClickLayerIds(FACHEBENEN.copernicus_bilder)).toEqual([]);
  });

  it('legt je darstellbarem Bild eine Rasterquelle mit Kachel-URL, Umriss und Zoomgrenzen an', () => {
    const map = fakeMap(['grund', 'abschnitte-fill']);
    synchronisiereCopernicusBilder(
      map as never,
      [bild(A, '2024-06-10 10:13:00'), bild(B, '2024-06-08 10:29:00', { darstellbar: false })],
      80,
    );
    expect(map._quellen.get(copernicusBildSourceId(A))).toEqual({
      type: 'raster',
      tiles: [`/api/map/overlays/copernicus/images/${A}/{z}/{x}/{y}`],
      tileSize: 256,
      bounds: [12.6, 48.8, 12.7, 48.9],
      minzoom: 10,
      maxzoom: 16,
    });
    expect(map._quellen.has(copernicusBildSourceId(B))).toBe(false);
    const l = map.addLayer.mock.calls[0][0] as unknown as {
      type: string;
      paint: Record<string, number>;
    };
    expect(l.type).toBe('raster');
    expect(l.paint['raster-opacity']).toBe(0.8);
    expect(l.paint['raster-fade-duration']).toBe(0);
  });

  it('liegt unter Fachebenen, Kartenbildern und Abschnitten, das jüngste Bild oben', () => {
    const map = fakeMap(['grund', 'bild-3-raster', 'abschnitte-fill', 'fachebene-nina-fill']);
    synchronisiereCopernicusBilder(
      map as never,
      [bild(B, '2024-06-08 10:29:00'), bild(A, '2024-06-10 10:13:00')],
      80,
    );
    expect(map._ids()).toEqual([
      'grund',
      copernicusBildLayerId(B),
      copernicusBildLayerId(A),
      'bild-3-raster',
      'abschnitte-fill',
      'fachebene-nina-fill',
    ]);
  });

  it('nimmt die unterste Fachebene als Anker, wenn es weder Kartenbild noch Abschnitt gibt', () => {
    const map = fakeMap(['grund', 'fachebene-dwd-fill', 'marker']);
    expect(copernicusBildAnker(map as never)).toBe('fachebene-dwd-fill');
    expect(copernicusBildAnker(fakeMap(['grund']) as never)).toBeUndefined();
  });

  it('entfernt verschwundene Bilder und räumt bei leerer Liste ab', () => {
    const map = fakeMap(['abschnitte-fill']);
    synchronisiereCopernicusBilder(
      map as never,
      [bild(A, '2024-06-10 10:13:00'), bild(B, '2024-06-08 10:29:00')],
      80,
    );
    synchronisiereCopernicusBilder(map as never, [bild(A, '2024-06-10 10:13:00')], 80);
    expect(map._ids()).toEqual([copernicusBildLayerId(A), 'abschnitte-fill']);
    expect(map._quellen.has(copernicusBildSourceId(B))).toBe(false);
    synchronisiereCopernicusBilder(map as never, [], 80);
    expect(map._ids()).toEqual(['abschnitte-fill']);
    expect(map._quellen.size).toBe(0);
  });

  it('ändert bei neuer Deckkraft nur die Farbe, legt nichts neu an', () => {
    const map = fakeMap(['abschnitte-fill']);
    synchronisiereCopernicusBilder(map as never, [bild(A, '2024-06-10 10:13:00')], 80);
    synchronisiereCopernicusBilder(map as never, [bild(A, '2024-06-10 10:13:00')], 35);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map._layer(copernicusBildLayerId(A))!.paint!['raster-opacity']).toBe(0.35);
    // Außerhalb von 0–100 geklemmt.
    synchronisiereCopernicusBilder(map as never, [bild(A, '2024-06-10 10:13:00')], 140);
    expect(map._layer(copernicusBildLayerId(A))!.paint!['raster-opacity']).toBe(1);
  });
});
