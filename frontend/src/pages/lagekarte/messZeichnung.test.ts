import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Nachbau des terra-draw-Ausschnitts, den `createMessung` benutzt: Features im Speicher,
 * `change`/`finish` feuert der Test selbst — so ist prüfbar, WAS gemeldet wird, ohne Karte.
 */
type Feature = { id: number; geometry: { type: string; coordinates: unknown } };
const td = vi.hoisted(() => ({
  instanz: null as null | {
    features: Map<number, Feature>;
    change: (ids: number[], typ: string) => void;
    finish: (id: number, ctx: { action: string }) => void;
    entfernt: number[];
    mode: string;
    enabled: boolean;
  },
}));

vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: class {
    map: MapLibreMap;
    constructor({ map }: { map: MapLibreMap }) {
      this.map = map;
    }
  },
}));

vi.mock('terra-draw', () => ({
  TerraDrawPolygonMode: class {},
  TerraDrawLineStringMode: class {},
  TerraDraw: class {
    enabled = false;
    features = new Map<number, Feature>();
    entfernt: number[] = [];
    mode = '';
    change: (ids: number[], typ: string) => void = () => {};
    finish: (id: number, ctx: { action: string }) => void = () => {};
    constructor({ adapter }: { adapter: { map: MapLibreMap } }) {
      td.instanz = this;
      adapter.map.getCanvas().addEventListener('keydown', (e) => {
        const ids = [...this.features.keys()];
        const offen = ids[ids.length - 1];
        if (e.key === 'Enter' && offen != null) this.finish(offen, { action: 'draw' });
      });
    }
    on(event: string, handler: never) {
      if (event === 'change') this.change = handler;
      if (event === 'finish') this.finish = handler;
    }
    start() {
      this.enabled = true;
    }
    stop() {
      this.enabled = false;
    }
    clear() {
      const ids = [...this.features.keys()];
      this.features.clear();
      if (ids.length) this.change(ids, 'delete');
    }
    setMode(m: string) {
      this.mode = m;
    }
    removeFeatures(ids: number[]) {
      ids.forEach((id) => this.features.delete(id));
      this.entfernt.push(...ids);
      this.change(ids, 'delete');
    }
    getSnapshotFeature(id: number) {
      return this.features.get(id);
    }
  },
}));

import { createMessung } from './messZeichnung';

function karte(): MapLibreMap {
  const canvas = document.createElement('canvas');
  return { getCanvas: () => canvas } as unknown as MapLibreMap;
}

/** `Array.prototype.at` fehlt im TS-Lib-Stand des Repos (ES2020). */
const letzte = <T>(a: T[]): T | undefined => a[a.length - 1];

const linie = (id: number, ...punkte: number[][]): Feature => ({
  id,
  geometry: { type: 'LineString', coordinates: punkte },
});

describe('createMessung (LFH-616)', () => {
  let meldungen: [unknown, boolean][];
  beforeEach(() => {
    meldungen = [];
  });

  function setup() {
    const m = createMessung(karte(), (g, fertig) => meldungen.push([g, fertig]));
    const draw = td.instanz!;
    return { m, draw };
  }

  it('meldet den laufenden Entwurf bei jeder Änderung, den Abschluss als fertig', () => {
    const { m, draw } = setup();
    m.starten('strecke');
    expect(draw.mode).toBe('linestring');
    meldungen = [];

    draw.features.set(1, linie(1, [0, 0], [0, 0]));
    draw.change([1], 'create');
    draw.features.set(1, linie(1, [0, 0], [1, 1]));
    draw.change([1], 'update');
    draw.finish(1, { action: 'draw' });

    expect(meldungen.map(([, f]) => f)).toEqual([false, false, true]);
    expect(meldungen[1][0]).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    });
  });

  it('räumt die vorige Messung, sobald eine neue beginnt — es steht nur eine da', () => {
    const { m, draw } = setup();
    m.starten('strecke');
    draw.features.set(1, linie(1, [0, 0], [1, 1]));
    draw.change([1], 'create');
    draw.finish(1, { action: 'draw' });

    draw.features.set(2, linie(2, [5, 5], [5, 5]));
    draw.change([2], 'create');
    expect(draw.entfernt).toEqual([1]);
    // Das eigene Entfernen erzeugt KEINE Leer-Meldung zwischen den beiden Messungen.
    expect(letzte(meldungen)).toEqual([
      {
        type: 'LineString',
        coordinates: [
          [5, 5],
          [5, 5],
        ],
      },
      false,
    ]);
  });

  it('meldet leer, wenn der Entwurf verworfen wird (Escape) oder die Messung endet', () => {
    const { m, draw } = setup();
    m.starten('flaeche');
    expect(draw.mode).toBe('polygon');
    draw.features.set(1, linie(1, [0, 0], [1, 1]));
    draw.change([1], 'create');
    draw.features.delete(1);
    draw.change([1], 'delete');
    expect(letzte(meldungen)).toEqual([null, false]);

    draw.features.set(2, linie(2, [0, 0], [1, 1]));
    draw.change([2], 'create');
    m.stoppen();
    expect(letzte(meldungen)).toEqual([null, false]);
    expect(draw.enabled).toBe(false);
  });

  it('schließt erst ab zwei verschiedenen Punkten ab (Strecke)', () => {
    const { m, draw } = setup();
    m.starten('strecke');
    expect(m.abschliessen()).toBe(false); // nichts gesetzt

    draw.features.set(1, linie(1, [0, 0], [0, 0]));
    draw.change([1], 'create');
    expect(m.abschliessen()).toBe(false);

    draw.features.set(1, linie(1, [0, 0], [1, 1]));
    draw.change([1], 'update');
    expect(m.abschliessen()).toBe(true);
    expect(letzte(meldungen)?.[1]).toBe(true);
  });

  it('ein Hilfspunkt von terra-draw wird nicht zur laufenden Messung', () => {
    const { m, draw } = setup();
    m.starten('flaeche');
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    draw.features.set(1, { id: 1, geometry: { type: 'Polygon', coordinates: [ring] } });
    draw.change([1], 'create');
    // Schließpunkt kommt als eigener `create` hinterher …
    draw.features.set(2, { id: 2, geometry: { type: 'Point', coordinates: [0, 0] } });
    draw.change([2], 'create');
    // … die Figur wächst weiter und wird weiter gemeldet.
    draw.change([1], 'update');
    expect(letzte(meldungen)).toEqual([{ type: 'Polygon', coordinates: [ring] }, false]);
  });

  it('nach stoppen() meldet ein Nachzügler von terra-draw nichts mehr', () => {
    const { m, draw } = setup();
    m.starten('strecke');
    m.stoppen();
    meldungen = [];
    draw.features.set(9, linie(9, [0, 0], [1, 1]));
    draw.change([9], 'create');
    draw.finish(9, { action: 'draw' });
    expect(meldungen).toEqual([]);
  });
});
