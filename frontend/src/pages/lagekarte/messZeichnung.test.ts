import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Nachbau des terra-draw-Ausschnitts, den `createMessung` benutzt: Features im Speicher,
 * `change`/`finish` feuert der Test selbst.
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
    stop: () => void;
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
import { stilKarteAttrappe } from '../../test/stilKarteAttrappe';

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

  it('zerstoeren() wirft nicht, wenn die Karte schon entfernt ist (LFH-943)', () => {
    const { m, draw } = setup();
    m.starten('strecke');
    // Wie der Adapter nach `map.remove()`: `clear()` → `getSource(…).setData` auf undefined.
    draw.stop = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'setData')");
    };
    expect(() => m.zerstoeren()).not.toThrow();
    // Danach meldet ein Nachzügler nichts mehr: die Messung gilt als beendet.
    meldungen = [];
    draw.features.set(9, linie(9, [0, 0], [1, 1]));
    draw.change([9], 'create');
    expect(meldungen).toEqual([]);
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

/**
 * „Messen ab hier“ (LFH-776, D6): terra-draw hat keinen öffentlichen Weg, einen ersten Punkt zu
 * setzen; `setzeStartpunkt` tippt ihn am Kartenelement des Adapters (Canvas) an der projizierten
 * Bildschirmstelle — terra-draw rechnet sie über das Rechteck des Containers zurück.
 */
describe('createMessung: setzeStartpunkt (LFH-776)', () => {
  function karteMitLage() {
    const canvas = document.createElement('canvas');
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
    const projiziert: [number, number][] = [];
    const map = {
      getCanvas: () => canvas,
      getContainer: () => container,
      project: ([lng, lat]: [number, number]) => {
        projiziert.push([lng, lat]);
        return { x: 30, y: 40 };
      },
    } as unknown as MapLibreMap;
    const ereignisse: PointerEvent[] = [];
    for (const t of ['pointerdown', 'pointerup'])
      canvas.addEventListener(t, (e) => ereignisse.push(e as PointerEvent));
    return { map, ereignisse, projiziert };
  }

  it('tippt den Punkt als primären Linksklick an der Bildschirmstelle an', () => {
    const { map, ereignisse, projiziert } = karteMitLage();
    const m = createMessung(map, () => {});
    m.starten('strecke');
    m.setzeStartpunkt({ lng: 11.5, lat: 53.6 });
    expect(projiziert).toEqual([[11.5, 53.6]]);
    expect(ereignisse.map((e) => e.type)).toEqual(['pointerdown', 'pointerup']);
    for (const e of ereignisse) {
      expect(e.clientX).toBe(130);
      expect(e.clientY).toBe(90);
      expect(e.isPrimary).toBe(true);
      expect(e.button).toBe(0);
    }
  });

  it('ohne laufende Messung tut es nichts', () => {
    const { map, ereignisse } = karteMitLage();
    const m = createMessung(map, () => {});
    m.setzeStartpunkt({ lng: 11.5, lat: 53.6 });
    m.starten('strecke');
    m.stoppen();
    m.setzeStartpunkt({ lng: 11.5, lat: 53.6 });
    expect(ereignisse).toEqual([]);
  });
});

/**
 * Vorschaukreis der Messform „Radius“ (LLH-1345, Spec `lagekarte-zeichnen`, „Radius messen“):
 * eigene Ebenen `td-mess-kreis-*`, gezeichnet aus derselben Mitte und demselben Rand wie die
 * Anzeige, abgebaut mit jeder neuen Messung und dem Ende des Messens.
 */
describe('createMessung: Vorschaukreis beim Radius (LLH-1345)', () => {
  const MESS_EBENEN = ['td-mess-kreis-flaeche', 'td-mess-kreis-linie'];
  const kreisEbenen = (ids: string[]) => ids.filter((id) => id.startsWith('td-mess-kreis'));

  function setup() {
    const k = stilKarteAttrappe(['grund']);
    const m = createMessung(
      k.map,
      () => {},
      () => '#0055aa',
    );
    return { k, m, draw: td.instanz! };
  }

  /** Teil `kreis` der Vorschau-Quelle oder `undefined`. */
  function kreisFeature(quellen: Map<string, unknown>) {
    const fc = quellen.get('td-mess-kreis') as
      | { features: { properties: { teil: string }; geometry: { coordinates: number[][][] } }[] }
      | undefined;
    return fc?.features.find((f) => f.properties.teil === 'kreis');
  }

  it('steht ab Mitte und Rand, folgt dem Rand und trägt die Farbe der Messung', () => {
    const { k, m, draw } = setup();
    m.starten('radius');
    draw.features.set(1, linie(1, [9, 52], [9, 52]));
    draw.change([1], 'create');
    // Nur die Mitte: noch kein Kreis.
    expect(kreisFeature(k.quellen)).toBeUndefined();

    draw.features.set(1, linie(1, [9, 52], [9, 52.001]));
    draw.change([1], 'update');
    expect(kreisEbenen(k.ids())).toEqual(MESS_EBENEN);
    expect(k.ebenen.find((e) => e.id === 'td-mess-kreis-linie')?.paint).toMatchObject({
      'line-color': '#0055aa',
    });
    const ring = kreisFeature(k.quellen)!.geometry.coordinates[0];
    // Der Rand liegt 0,001° nördlich (≈ 111 m): ein Ringpunkt erreicht diese Breite.
    expect(Math.max(...ring.map(([, lat]) => lat))).toBeCloseTo(52.001, 5);

    draw.features.set(1, linie(1, [9, 52], [9, 52.002]));
    draw.change([1], 'update');
    const weiter = kreisFeature(k.quellen)!.geometry.coordinates[0];
    expect(Math.max(...weiter.map(([, lat]) => lat))).toBeCloseTo(52.002, 5);
  });

  it('bleibt nach dem Abschluss stehen; „Neu messen“ und eine andere Form bauen ihn ab', () => {
    const { k, m, draw } = setup();
    m.starten('radius');
    draw.features.set(1, linie(1, [9, 52], [9, 52.001]));
    draw.change([1], 'create');
    draw.finish(1, { action: 'draw' });
    expect(kreisEbenen(k.ids())).toEqual(MESS_EBENEN);

    m.starten('radius');
    expect(kreisEbenen(k.ids())).toEqual([]);
    expect(k.quellen.has('td-mess-kreis')).toBe(false);

    draw.features.set(2, linie(2, [9, 52], [9, 52.001]));
    draw.change([2], 'create');
    expect(kreisEbenen(k.ids())).toEqual(MESS_EBENEN);
    m.starten('strecke');
    expect(kreisEbenen(k.ids())).toEqual([]);
  });

  it('eine neue Mitte nach dem Abschluss räumt den alten Kreis', () => {
    const { k, m, draw } = setup();
    m.starten('radius');
    draw.features.set(1, linie(1, [9, 52], [9, 52.001]));
    draw.change([1], 'create');
    draw.finish(1, { action: 'draw' });
    draw.features.set(2, linie(2, [10, 53], [10, 53]));
    draw.change([2], 'create');
    expect(kreisFeature(k.quellen)).toBeUndefined();
  });

  it('Beenden und verworfener Entwurf bauen ihn ab', () => {
    const { k, m, draw } = setup();
    m.starten('radius');
    draw.features.set(1, linie(1, [9, 52], [9, 52.001]));
    draw.change([1], 'create');
    draw.features.delete(1);
    draw.change([1], 'delete');
    expect(kreisEbenen(k.ids())).toEqual([]);

    draw.features.set(2, linie(2, [9, 52], [9, 52.001]));
    draw.change([2], 'create');
    expect(kreisEbenen(k.ids())).toEqual(MESS_EBENEN);
    m.stoppen();
    expect(kreisEbenen(k.ids())).toEqual([]);
    expect(k.quellen.has('td-mess-kreis')).toBe(false);
  });

  it('Strecke und Fläche zeichnen keinen Kreis', () => {
    const { k, m, draw } = setup();
    m.starten('strecke');
    draw.features.set(1, linie(1, [9, 52], [9, 52.001]));
    draw.change([1], 'create');
    expect(kreisEbenen(k.ids())).toEqual([]);
  });

  it('zerstoeren() baut ihn ab und wirft nicht, wenn die Karte schon entfernt ist', () => {
    const { k, m, draw } = setup();
    m.starten('radius');
    draw.features.set(1, linie(1, [9, 52], [9, 52.001]));
    draw.change([1], 'create');
    m.zerstoeren();
    expect(kreisEbenen(k.ids())).toEqual([]);

    const zweite = setup();
    zweite.m.starten('radius');
    zweite.draw.features.set(1, linie(1, [9, 52], [9, 52.001]));
    zweite.draw.change([1], 'create');
    // Wie nach `map.remove()`: der Stil ist weg, jeder Zugriff wirft.
    (zweite.k.map as unknown as { getLayer: () => never }).getLayer = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'getLayer')");
    };
    expect(() => zweite.m.zerstoeren()).not.toThrow();
  });
});
