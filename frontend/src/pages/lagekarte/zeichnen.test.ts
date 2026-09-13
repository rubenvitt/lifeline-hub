import { describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

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
    private finish?: (id: number, context: { action: string }) => void;
    private readonly canvas: HTMLCanvasElement;
    private mode = 'polygon';

    constructor({ adapter }: { adapter: { map: MapLibreMap } }) {
      this.canvas = adapter.map.getCanvas();
      this.canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') this.finish?.(1, { action: 'draw' });
      });
    }

    on(event: string, handler: (id: number, context: { action: string }) => void) {
      if (event === 'finish') this.finish = handler;
    }

    start() {
      this.enabled = true;
    }
    stop() {
      this.enabled = false;
    }
    clear() {}
    setMode(mode: string) {
      this.mode = mode;
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

import { createZeichnung } from './zeichnen';

describe('createZeichnung — expliziter Abschluss', () => {
  it('meldet erst ab drei gesetzten Punkten Bereitschaft und bestätigt nur ein echtes Finish', () => {
    const canvas = document.createElement('canvas');
    const map = { getCanvas: () => canvas } as unknown as MapLibreMap;
    const fertig = vi.fn();
    const bereitschaft = vi.fn();
    const zeichnung = createZeichnung(map, fertig, bereitschaft);

    zeichnung.starten('polygon');
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 10 }));
    expect(zeichnung.abschliessen()).toBe(false);
    expect(fertig).not.toHaveBeenCalled();

    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 10 }));
    expect(zeichnung.abschliessen()).toBe(false);
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    expect(bereitschaft).toHaveBeenLastCalledWith(true);
    expect(zeichnung.abschliessen()).toBe(true);
    expect(fertig).toHaveBeenCalledWith(expect.objectContaining({ type: 'Polygon' }));
  });

  it('gibt eine Linie bereits nach zwei verschiedenen Punkten zum Abschluss frei', () => {
    const canvas = document.createElement('canvas');
    const map = { getCanvas: () => canvas } as unknown as MapLibreMap;
    const fertig = vi.fn();
    const bereitschaft = vi.fn();
    const zeichnung = createZeichnung(map, fertig, bereitschaft);

    zeichnung.starten('linie');
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(zeichnung.abschliessen()).toBe(false);
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));

    expect(bereitschaft).toHaveBeenLastCalledWith(true);
    expect(zeichnung.abschliessen()).toBe(true);
    expect(fertig).toHaveBeenCalledWith(expect.objectContaining({ type: 'LineString' }));
  });
});
