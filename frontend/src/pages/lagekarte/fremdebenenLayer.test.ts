import { describe, expect, it, vi } from 'vitest';
import type { FeatureCollection } from '../../api/fachebenen';
import { synchronisiereBildLayer } from './bildLayer';
import {
  bildAnker,
  entferneFremdebeneLayer,
  fremdObjektSichtbar,
  fremdebeneClickLayerIds,
  fremdebeneIdVon,
  fremdebeneLayerIds,
  fremdebeneSourceId,
  sorgeFuerFremdebeneLayer,
} from './fremdebenenLayer';
import { baueFlaechenFc, baueZonenFc, planeReAnlegenNachStyle } from './kartenLayer';

interface LayerSpec {
  id: string;
  type: string;
  source?: string;
  minzoom?: number;
  filter?: unknown;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

/** Fake-Map: Layer in Zeichenfolge (`beforeId` fügt davor ein), Quellen mit `setData`, Render-Takt. */
function fakeMap(bereit = () => true) {
  const quellen = new Map<
    string,
    { setData: ReturnType<typeof vi.fn>; setCoordinates: ReturnType<typeof vi.fn> }
  >();
  const folge: string[] = [];
  const specs = new Map<string, LayerSpec>();
  const hoerer: Record<string, Array<() => void>> = {};
  const map = {
    get style() {
      return { _loaded: bereit() };
    },
    on: vi.fn((ev: string, cb: () => void) => {
      (hoerer[ev] ??= []).push(cb);
    }),
    off: vi.fn((ev: string, cb: () => void) => {
      hoerer[ev] = (hoerer[ev] ?? []).filter((h) => h !== cb);
    }),
    getSource: vi.fn((id: string) => quellen.get(id)),
    addSource: vi.fn((id: string) => {
      quellen.set(id, { setData: vi.fn(), setCoordinates: vi.fn() });
    }),
    removeSource: vi.fn((id: string) => quellen.delete(id)),
    getLayer: vi.fn((id: string) => (specs.has(id) ? specs.get(id) : undefined)),
    addLayer: vi.fn((spec: LayerSpec, beforeId?: string) => {
      specs.set(spec.id, spec);
      const i = beforeId ? folge.indexOf(beforeId) : -1;
      if (i >= 0) folge.splice(i, 0, spec.id);
      else folge.push(spec.id);
    }),
    removeLayer: vi.fn((id: string) => {
      specs.delete(id);
      folge.splice(folge.indexOf(id), 1);
    }),
    moveLayer: vi.fn(),
    setPaintProperty: vi.fn((id: string, name: string, wert: unknown) => {
      const spec = specs.get(id);
      if (spec) spec.paint = { ...spec.paint, [name]: wert };
    }),
    getStyle: vi.fn(() => undefined),
    getLayersOrder: () => [...folge],
    feuere: (ev: string) => (hoerer[ev] ?? []).slice().forEach((h) => h()),
    _quellen: quellen,
    _folge: folge,
    _specs: specs,
  };
  return map;
}

const DATEN: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [13.06, 52.39] },
      properties: { name: 'H 12', description: 'DN 100' },
    },
  ],
};
const FARBE = '#2f54eb';

describe('Fremdebenen auf der Karte (LLH-2099)', () => {
  it('legt Quelle und fünf Layer in der Ebenenfarbe an', () => {
    const map = fakeMap();
    sorgeFuerFremdebeneLayer(map as never, 7, DATEN, FARBE);

    expect(map.addSource).toHaveBeenCalledWith(
      'fremdebene-7',
      expect.objectContaining({ type: 'geojson', data: DATEN }),
    );
    expect(fremdebeneSourceId(7)).toBe('fremdebene-7');
    expect(fremdebeneLayerIds(7)).toEqual([
      'fremdebene-7-flaeche',
      'fremdebene-7-umriss',
      'fremdebene-7-linie',
      'fremdebene-7-punkt',
      'fremdebene-7-text',
    ]);
    expect(map._folge).toEqual(fremdebeneLayerIds(7));
    expect(map._specs.get('fremdebene-7-flaeche')?.paint?.['fill-color']).toBe(FARBE);
    expect(map._specs.get('fremdebene-7-linie')?.paint?.['line-color']).toBe(FARBE);
    expect(map._specs.get('fremdebene-7-umriss')?.paint?.['line-color']).toBe(FARBE);
    expect(map._specs.get('fremdebene-7-punkt')?.paint?.['circle-color']).toBe(FARBE);
    // Beschriftung aus `name`, erst ab einer Zoomstufe.
    const text = map._specs.get('fremdebene-7-text');
    expect(text?.layout?.['text-field']).toEqual(['get', 'name']);
    expect(text?.minzoom).toBeGreaterThan(0);
  });

  it('liegt unter den eigenen Lage-Layern, über Bildern', () => {
    const map = fakeMap();
    map.addLayer({ id: 'bild-1-raster', type: 'raster' });
    map.addLayer({ id: 'abschnitte-fill', type: 'fill' });
    map.addLayer({ id: 'zonen-fill', type: 'fill' });
    sorgeFuerFremdebeneLayer(map as never, 7, DATEN, FARBE);
    expect(map._folge).toEqual([
      'bild-1-raster',
      ...fremdebeneLayerIds(7),
      'abschnitte-fill',
      'zonen-fill',
    ]);
  });

  it('ein später hinzugekommenes Bild legt sich unter die Fremdebene, nicht darüber', () => {
    const map = fakeMap();
    map.addLayer({ id: 'abschnitte-fill', type: 'fill' });
    sorgeFuerFremdebeneLayer(map as never, 7, DATEN, FARBE);
    const bild = {
      id: 3,
      blobUrl: 'blob:x',
      ecken: [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
      opazitaet: 100,
      sichtbar: true,
    };
    synchronisiereBildLayer(map as never, [bild as never], bildAnker(map as never));
    expect(map._folge).toEqual(['bild-3-raster', ...fremdebeneLayerIds(7), 'abschnitte-fill']);
  });

  it('ohne Fremdebene liegt der Anker der Bilder vor den eigenen Lage-Layern', () => {
    const map = fakeMap();
    map.addLayer({ id: 'abschnitte-fill', type: 'fill' });
    expect(bildAnker(map as never)).toBe('abschnitte-fill');
  });

  it('der Umriss einer Fläche ist ein eigener Layer und kein Klickziel; die Linie trägt nur Linien', () => {
    const map = fakeMap();
    sorgeFuerFremdebeneLayer(map as never, 7, DATEN, FARBE);
    expect(JSON.stringify(map._specs.get('fremdebene-7-linie')?.filter)).not.toMatch(/Polygon/);
    expect(JSON.stringify(map._specs.get('fremdebene-7-umriss')?.filter)).toMatch(/Polygon/);
    expect(fremdebeneClickLayerIds(7)).toEqual([
      'fremdebene-7-flaeche',
      'fremdebene-7-linie',
      'fremdebene-7-punkt',
    ]);
  });

  it('ist idempotent: ein zweiter Lauf spielt Daten ein und zieht die Farbe nach', () => {
    const map = fakeMap();
    sorgeFuerFremdebeneLayer(map as never, 7, DATEN, FARBE);
    sorgeFuerFremdebeneLayer(map as never, 7, DATEN, '#9e1068');
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(5);
    expect(map._quellen.get('fremdebene-7')?.setData).toHaveBeenCalledWith(DATEN);
    expect(map._specs.get('fremdebene-7-flaeche')?.paint?.['fill-color']).toBe('#9e1068');
    expect(map._specs.get('fremdebene-7-punkt')?.paint?.['circle-color']).toBe('#9e1068');
  });

  it('räumt beim Entfernen alle Layer und die Quelle', () => {
    const map = fakeMap();
    sorgeFuerFremdebeneLayer(map as never, 7, DATEN, FARBE);
    sorgeFuerFremdebeneLayer(map as never, 8, DATEN, FARBE);
    entferneFremdebeneLayer(map as never, 7);
    expect(map._folge).toEqual(fremdebeneLayerIds(8));
    expect(map._quellen.has('fremdebene-7')).toBe(false);
    // Idempotent: ein zweiter Aufruf wirft nicht.
    expect(() => entferneFremdebeneLayer(map as never, 7)).not.toThrow();
  });

  it('steht nach einem Stilwechsel wieder auf der Karte (`reAnlegenAlles`-Weg)', () => {
    let bereit = false;
    const map = fakeMap(() => bereit);
    planeReAnlegenNachStyle(
      map as never,
      () => baueFlaechenFc([]),
      () => baueZonenFc([]),
      () => [],
      () => [],
      undefined,
      undefined,
      () => [{ id: 7, name: 'Lage Nachbarkreis', daten: DATEN, farbe: FARBE }],
    );
    map.feuere('render');
    expect(map._quellen.has('fremdebene-7')).toBe(false);

    bereit = true;
    map.feuere('render');
    expect(map.addSource).toHaveBeenCalledWith(
      'fremdebene-7',
      expect.objectContaining({ data: DATEN }),
    );
    expect(map._specs.get('fremdebene-7-flaeche')?.paint?.['fill-color']).toBe(FARBE);
    // Unter den eigenen Lage-Layern, die der Neuaufbau mit anlegt.
    expect(map._folge.indexOf('fremdebene-7-flaeche')).toBeLessThan(
      map._folge.indexOf('abschnitte-fill'),
    );
  });

  it('liest die Ebene aus einer Layer-ID', () => {
    expect(fremdebeneIdVon('fremdebene-12-punkt')).toBe(12);
    expect(fremdebeneIdVon('fremdebene-12-flaeche')).toBe(12);
    expect(fremdebeneIdVon('fachebene-dwd-fill')).toBeNull();
  });
});

describe('Auswahl eines Fremdebenen-Objekts (LLH-2099)', () => {
  const aktiv = [{ id: 7, name: 'Hydranten', daten: DATEN, farbe: FARBE }];

  it('gilt, solange die Ebene gezeigt wird und das Objekt darin steht', () => {
    expect(fremdObjektSichtbar(aktiv, 7, { name: 'H 12', description: 'DN 100' })).toBe(true);
  });

  it('gilt nicht mehr, wenn die Ebene ausgeblendet oder entfernt ist', () => {
    expect(fremdObjektSichtbar([], 7, { name: 'H 12', description: 'DN 100' })).toBe(false);
  });

  it('gilt nicht mehr, wenn das Objekt beim Abgleich weggefallen oder geändert ist', () => {
    expect(fremdObjektSichtbar(aktiv, 7, { name: 'H 13', description: 'DN 100' })).toBe(false);
    expect(fremdObjektSichtbar(aktiv, 7, { name: 'H 12' })).toBe(false);
  });

  it('ein fehlendes und ein leeres Feld gelten gleich (die Karte reicht Leeres nicht durch)', () => {
    const ohneBeschreibung: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [13, 52] },
          properties: { name: 'H 1', description: null },
        },
      ],
    };
    expect(
      fremdObjektSichtbar([{ ...aktiv[0], daten: ohneBeschreibung }], 7, { name: 'H 1' }),
    ).toBe(true);
  });
});
