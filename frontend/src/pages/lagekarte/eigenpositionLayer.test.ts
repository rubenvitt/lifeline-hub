import { describe, expect, it, vi } from 'vitest';
import {
  EIGENPOSITION_LAYER,
  EIGENPOSITION_QUELLE,
  eigenpositionFc,
  eigenpositionRahmen,
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

describe('eigenpositionRahmen (LFH-766)', () => {
  it('umschließt bei 2 km jeden Punkt des Kreises und liegt symmetrisch um den Standort', () => {
    const pos = { lat: 52.37, lon: 9.73, genauigkeit: 2000 };
    const [[west, sued], [ost, nord]] = eigenpositionRahmen(pos);
    for (const [lon, lat] of genauigkeitsKreis(pos.lat, pos.lon, pos.genauigkeit)) {
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(ost);
      expect(lat).toBeGreaterThanOrEqual(sued);
      expect(lat).toBeLessThanOrEqual(nord);
    }
    // Nord-Süd-Ausdehnung = Durchmesser (±1 %), unabhängig gerechnet.
    expect(Math.abs(abstandM([pos.lon, sued], [pos.lon, nord]) - 4000) / 4000).toBeLessThan(0.01);
    expect(ost - pos.lon).toBeCloseTo(pos.lon - west, 6);
    expect(nord - pos.lat).toBeCloseTo(pos.lat - sued, 3);
  });

  it('fällt bei Radius 0 auf den Punkt zusammen', () => {
    expect(eigenpositionRahmen({ lat: 52, lon: 9, genauigkeit: 0 })).toEqual([
      [9, 52],
      [9, 52],
    ]);
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

/** Karte mit echter Ebenenfolge: `addLayer`/`moveLayer` ordnen wie MapLibre (ohne `vor` ans Ende). */
function fakeMap(vorhanden: string[] = []) {
  const quellen = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, Record<string, unknown>>();
  const folge = [...vorhanden];
  for (const id of vorhanden) layers.set(id, { id });
  const moves: string[] = [];
  const einordnen = (id: string, vor?: string) => {
    const alt = folge.indexOf(id);
    if (alt >= 0) folge.splice(alt, 1);
    const ziel = vor ? folge.indexOf(vor) : -1;
    if (ziel >= 0) folge.splice(ziel, 0, id);
    else folge.push(id);
  };
  const map = {
    getSource: (id: string) => quellen.get(id),
    addSource: vi.fn((id: string) => quellen.set(id, { setData: vi.fn() })),
    getLayer: (id: string) => layers.get(id),
    getStyle: () => ({ layers: folge.map((id) => ({ id })) }),
    addLayer: vi.fn((l: Record<string, unknown>, vor?: string) => {
      layers.set(l.id as string, l);
      einordnen(l.id as string, vor);
    }),
    setPaintProperty: vi.fn(),
    moveLayer: vi.fn((id: string, vor?: string) => {
      moves.push(id);
      einordnen(id, vor);
    }),
  };
  return { map, quellen, layers, moves, folge };
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

  it('LFH-766: liegt unter der laufenden Zeichnung, auch nach weiteren Meldungen', () => {
    const { map, folge } = fakeMap([
      'marker-punkte',
      'suchnadel-punkt',
      'td-zone-polygon',
      'td-zone-point',
    ]);
    const pos = eigenpositionFc({ lat: 52, lon: 9, genauigkeit: 30 });
    sorgeFuerEigenpositionLayer(map as never, pos, '#1677ff');
    sorgeFuerEigenpositionLayer(map as never, pos, '#1677ff');
    expect(folge).toEqual([
      'marker-punkte',
      'suchnadel-punkt',
      ...EIGENPOSITION_LAYER,
      'td-zone-polygon',
      'td-zone-point',
    ]);
  });

  it('LFH-766: ohne Zeichnung ganz oben, über später angelegten Lagedaten', () => {
    const { map, folge } = fakeMap(['marker-punkte']);
    const pos = eigenpositionFc({ lat: 52, lon: 9, genauigkeit: 30 });
    sorgeFuerEigenpositionLayer(map as never, pos, '#1677ff');
    map.addLayer({ id: 'zonen-flaeche' });
    sorgeFuerEigenpositionLayer(map as never, pos, '#1677ff');
    expect(folge).toEqual(['marker-punkte', 'zonen-flaeche', ...EIGENPOSITION_LAYER]);
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
