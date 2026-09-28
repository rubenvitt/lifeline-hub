import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: class {
    map: MapLibreMap;
    constructor({ map }: { map: MapLibreMap }) {
      this.map = map;
    }
  },
}));

/** Aufzeichnung der Konstruktor-Optionen — die Undo- und Tastenoptionen SIND die Zusicherung. */
const aufrufe = vi.hoisted(() => ({
  terraDraw: [] as Record<string, unknown>[],
  modi: [] as { name: string; optionen: unknown }[],
  undo: 0,
  clear: 0,
  /** Nächster Klick setzt in terra-draw KEINEN Punkt (Mikro-Ziehen, Phantomklick). */
  verschlucken: false,
}));

vi.mock('terra-draw', () => ({
  TerraDrawPolygonMode: class {
    constructor(optionen?: unknown) {
      aufrufe.modi.push({ name: 'polygon', optionen });
    }
  },
  TerraDrawLineStringMode: class {
    constructor(optionen?: unknown) {
      aufrufe.modi.push({ name: 'linestring', optionen });
    }
  },
  TerraDrawModeUndoRedo: class {},
  TerraDraw: class {
    enabled = false;
    private finish?: (id: number, context: { action: string }) => void;
    private history?: (e: { stack: string; undoSize: number }) => void;
    private readonly canvas: HTMLCanvasElement;
    private mode = 'polygon';
    /** Koordinaten der laufenden Figur, wie terra-draw sie hält. */
    private stapel: string[] = [];

    constructor(optionen: { adapter: { map: MapLibreMap } } & Record<string, unknown>) {
      aufrufe.terraDraw.push(optionen);
      this.canvas = optionen.adapter.map.getCanvas();
      this.canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') this.finish?.(1, { action: 'draw' });
      });
      // Wie terra-draw 1.34: ein gesetzter Punkt landet auf dem Modus-Stapel und meldet die
      // neue Größe als `history`. Derselbe Pixel ergibt keinen zweiten Punkt.
      this.canvas.addEventListener('click', (event) => {
        if (!this.enabled) return;
        if (aufrufe.verschlucken) {
          aufrufe.verschlucken = false;
          return;
        }
        const p = `${event.clientX}:${event.clientY}`;
        if (this.stapel[this.stapel.length - 1] === p) return;
        this.stapel.push(p);
        this.history?.({ stack: 'mode', undoSize: this.stapel.length });
      });
    }

    on(event: string, handler: never) {
      if (event === 'finish') this.finish = handler;
      if (event === 'history') this.history = handler;
    }

    start() {
      this.enabled = true;
    }
    stop() {
      this.enabled = false;
    }
    clear() {
      aufrufe.clear += 1;
      this.stapel = [];
    }
    setMode(mode: string) {
      this.mode = mode;
    }
    // Wie terra-draw 1.34 (im Bundle gemessen): beide WERFEN, solange die Instanz gestoppt ist.
    undo() {
      if (!this.enabled) throw new Error('Terra Draw is not enabled');
      aufrufe.undo += 1;
      if (this.stapel.pop() == null) return false;
      this.history?.({ stack: 'mode', undoSize: this.stapel.length });
      return true;
    }
    canUndo() {
      if (!this.enabled) throw new Error('Terra Draw is not enabled');
      return this.stapel.length > 0;
    }
    getSnapshot() {
      if (this.mode === 'linestring') {
        return [
          {
            id: 1,
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        ];
      }
      return [
        {
          id: 1,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      ];
    }
  },
}));

import { createZeichnung, type ZeichenStand } from './zeichnen';

function aufbau() {
  const canvas = document.createElement('canvas');
  const map = { getCanvas: () => canvas } as unknown as MapLibreMap;
  const fertig = vi.fn();
  const stand = vi.fn<(s: ZeichenStand) => void>();
  const zeichnung = createZeichnung(map, fertig, stand);
  const klick = (x: number, y: number) =>
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  const letzter = () => stand.mock.lastCall?.[0];
  return { canvas, fertig, stand, zeichnung, klick, letzter };
}

beforeEach(() => {
  aufrufe.terraDraw.length = 0;
  aufrufe.modi.length = 0;
  aufrufe.undo = 0;
  aufrufe.clear = 0;
  aufrufe.verschlucken = false;
});

describe('createZeichnung — expliziter Abschluss', () => {
  it('meldet erst ab drei gesetzten Punkten Bereitschaft und bestätigt nur ein echtes Finish', () => {
    const { fertig, zeichnung, klick, letzter } = aufbau();

    zeichnung.starten('polygon');
    klick(10, 10);
    klick(20, 10);
    expect(zeichnung.abschliessen()).toBe(false);
    expect(fertig).not.toHaveBeenCalled();

    klick(20, 10);
    expect(zeichnung.abschliessen()).toBe(false);
    klick(20, 20);
    expect(letzter()).toEqual({ punkte: 3, bereit: true, kannZurueck: true });
    expect(zeichnung.abschliessen()).toBe(true);
    expect(fertig).toHaveBeenCalledWith(expect.objectContaining({ type: 'Polygon' }));
  });

  it('gibt eine Linie bereits nach zwei verschiedenen Punkten zum Abschluss frei', () => {
    const { fertig, zeichnung, klick, letzter } = aufbau();

    zeichnung.starten('linie');
    klick(10, 10);
    expect(zeichnung.abschliessen()).toBe(false);
    klick(20, 20);

    expect(letzter()?.bereit).toBe(true);
    expect(zeichnung.abschliessen()).toBe(true);
    expect(fertig).toHaveBeenCalledWith(expect.objectContaining({ type: 'LineString' }));
  });
});

describe('createZeichnung — Konstruktor (LFH-712)', () => {
  it('schaltet terra-draws Undo auf Modus-Ebene ein — ohne die Option liefert undo() immer false', () => {
    aufbau();
    const undoRedo = aufrufe.terraDraw[0]?.undoRedo as { modeLevel?: unknown } | undefined;
    expect(undoRedo?.modeLevel).toBeDefined();
  });

  it('nimmt terra-draw das Escape ab und lässt Enter als Abschluss stehen', () => {
    aufbau();
    // Beide Zeichen-Modi, nicht nur einer: sonst wäre das Esc je nach Modus zwei- oder einstufig.
    expect(aufrufe.modi.map((m) => m.name).sort()).toEqual(['linestring', 'polygon']);
    for (const m of aufrufe.modi) {
      expect(m.optionen).toMatchObject({ keyEvents: { cancel: null, finish: 'Enter' } });
    }
  });
});

describe('createZeichnung — Punktstand und Zurücknehmen (LFH-712)', () => {
  it('ohne Punkt nicht zurücknehmbar, ab dem ersten Punkt schon — als Paar', () => {
    const { zeichnung, klick, letzter } = aufbau();
    zeichnung.starten('polygon');
    expect(letzter()).toEqual({ punkte: 0, bereit: false, kannZurueck: false });
    klick(10, 10);
    expect(letzter()).toEqual({ punkte: 1, bereit: false, kannZurueck: true });
  });

  it('nimmt genau einen Punkt zurück, und „bereit" fällt unter die Mindestzahl', () => {
    const { zeichnung, klick, letzter } = aufbau();
    zeichnung.starten('polygon');
    klick(10, 10);
    klick(20, 10);
    klick(20, 20);
    expect(zeichnung.punktZurueck()).toBe(true);
    expect(aufrufe.undo).toBe(1);
    expect(letzter()).toEqual({ punkte: 2, bereit: false, kannZurueck: true });
  });

  it('nach dem Zurücknehmen des letzten Punktes gesperrt, das Zeichnen läuft weiter', () => {
    const { zeichnung, klick, letzter } = aufbau();
    zeichnung.starten('polygon');
    klick(10, 10);
    expect(zeichnung.punktZurueck()).toBe(true);
    expect(letzter()).toEqual({ punkte: 0, bereit: false, kannZurueck: false });
    // Weiterzeichnen geht ohne Neustart.
    klick(30, 30);
    expect(letzter()?.punkte).toBe(1);
  });

  it('ohne Punkt ruft punktZurueck terra-draw gar nicht erst', () => {
    const { zeichnung } = aufbau();
    zeichnung.starten('polygon');
    expect(zeichnung.punktZurueck()).toBe(false);
    expect(aufrufe.undo).toBe(0);
  });

  it('wirft nicht, wenn TerraDraw gestoppt ist', () => {
    const { zeichnung } = aufbau();
    expect(() => zeichnung.punktZurueck()).not.toThrow();
    expect(zeichnung.punktZurueck()).toBe(false);
    zeichnung.starten('polygon');
    zeichnung.stoppen();
    expect(zeichnung.punktZurueck()).toBe(false);
  });

  it('zählt, was terra-draw setzt — ein Klick ohne gesetzten Punkt zählt nicht', () => {
    // Mikro-Ziehen am Tablet: MapLibre meldet einen Klick, terra-draw setzt keinen Punkt.
    // Ein eigener Klickzähler zeigte „1 Punkt" für eine leere Figur, „zurück" stünde frei.
    const { zeichnung, klick, letzter } = aufbau();
    zeichnung.starten('polygon');
    aufrufe.verschlucken = true;
    klick(10, 10);
    expect(letzter()).toEqual({ punkte: 0, bereit: false, kannZurueck: false });
    expect(zeichnung.punktZurueck()).toBe(false);
  });

  it('ein früher benutzter Pixel zählt wieder, wenn terra-draw ihn setzt', () => {
    const { zeichnung, klick, letzter } = aufbau();
    zeichnung.starten('polygon');
    klick(10, 10);
    klick(20, 10);
    klick(10, 10);
    expect(letzter()?.punkte).toBe(3);
  });

  it('meldet einen unveränderten Stand nicht doppelt', () => {
    const { zeichnung, klick, stand } = aufbau();
    zeichnung.starten('polygon');
    klick(10, 10);
    const vorher = stand.mock.calls.length;
    // Doppelklick-Hälfte am selben Pixel: kein neuer Punkt, also keine neue Meldung.
    klick(10, 10);
    expect(stand.mock.calls.length).toBe(vorher);
  });
});

describe('createZeichnung — Verwerfen (LFH-712)', () => {
  it('verwirft die Figur, bleibt im Zeichenmodus und meldet Stand 0', () => {
    const { zeichnung, klick, letzter, fertig } = aufbau();
    zeichnung.starten('polygon');
    klick(10, 10);
    klick(20, 10);
    const clearVorher = aufrufe.clear;
    zeichnung.verwerfen();
    expect(aufrufe.clear).toBe(clearVorher + 1);
    expect(letzter()).toEqual({ punkte: 0, bereit: false, kannZurueck: false });
    // Weiter im Modus: neue Punkte zählen, drei davon schließen ab.
    klick(1, 1);
    klick(2, 1);
    klick(2, 2);
    expect(letzter()?.bereit).toBe(true);
    expect(zeichnung.abschliessen()).toBe(true);
    expect(fertig).toHaveBeenCalledTimes(1);
  });

  it('ist außerhalb des Zeichnens wirkungslos', () => {
    const { zeichnung, stand } = aufbau();
    zeichnung.verwerfen();
    expect(aufrufe.clear).toBe(0);
    expect(stand).not.toHaveBeenCalled();
  });
});
