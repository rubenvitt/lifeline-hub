import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';
import type { GeoJsonPolygon } from './geo';
import type { Ecken } from '../../api/kartenbilder';

/**
 * Ressourcen der Kartenfläche über lange Laufzeiten (LFH-943, LFH-945): Abbaureihenfolge beim
 * Aushängen und `setData` auf die Abschnittsflächen nur bei inhaltlicher Änderung. Die Karte ist
 * ein Nachbau: jede nicht nachgebaute Methode ist ein stummer Spion, damit die 1700 Zeilen der
 * Kartenfläche ohne WebGL laufen.
 */
const karte = vi.hoisted(() => ({
  instanz: null as null | Record<string, unknown>,
  entfernt: false,
  setDataAbschnitte: 0,
  ereignisse: [] as string[],
}));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor() {
      karte.instanz = this as unknown as Record<string, unknown>;
      karte.entfernt = false;
      const quellen = new Map<string, { setData: () => void }>();
      const ebenen = new Set<string>();
      const eigen: Record<string, unknown> = {
        get style() {
          return karte.entfernt ? undefined : { _loaded: true };
        },
        getSource: (id: string) => quellen.get(id),
        addSource: (id: string) => {
          quellen.set(id, {
            setData: () => {
              if (id === 'abschnitte') karte.setDataAbschnitte += 1;
            },
          });
        },
        getLayer: (id: string) => (ebenen.has(id) ? {} : undefined),
        addLayer: (spec: { id: string }) => ebenen.add(spec.id),
        getCanvas: () => document.createElement('canvas'),
        getContainer: () => document.createElement('div'),
        getStyle: () => ({ layers: [] }),
        // Der Stil gilt als angewandt: ein vertagter Start (Zonen, LFH-825) läuft sofort.
        once: (ev: string, cb: () => void) => {
          if (ev === 'style.load' || ev === 'load') cb();
        },
        remove: () => {
          karte.ereignisse.push('map.remove');
          karte.entfernt = true;
        },
      };
      return new Proxy(eigen, {
        get(ziel, schluessel) {
          if (schluessel in ziel) return Reflect.get(ziel, schluessel);
          const spion = vi.fn();
          Reflect.set(ziel, schluessel, spion);
          return spion;
        },
      });
    }
  }
  class Leer {
    onAdd() {
      return document.createElement('div');
    }
    onRemove() {}
    remove() {}
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    extend() {
      return this;
    }
  }
  const modul = {
    Map: FakeMap,
    AttributionControl: Leer,
    ScaleControl: Leer,
    Marker: Leer,
    LngLatBounds: Leer,
    setWorkerUrl: vi.fn(),
    setWorkerCount: vi.fn(),
  };
  return { ...modul, default: modul };
});

vi.mock('./maplibreWorker', () => ({}));

/** Controller-Nachbau: `zerstoeren()` wirft wie terra-draw, wenn die Karte schon weg ist. */
const controllerNachbau = (name: string) => ({
  starten: vi.fn(),
  stoppen: vi.fn(),
  zerstoeren: vi.fn(() => {
    karte.ereignisse.push(`${name}.zerstoeren`);
    if (karte.entfernt)
      throw new TypeError("Cannot read properties of undefined (reading 'setData')");
  }),
  abschliessen: vi.fn(() => false),
  punktZurueck: vi.fn(() => false),
  verwerfen: vi.fn(),
  setzeStartpunkt: vi.fn(),
});
vi.mock('./messZeichnung', () => ({ createMessung: () => controllerNachbau('messen') }));
vi.mock('./bildHandles', () => ({
  erzeugeBildHandles: () => ({
    setzeEcken: vi.fn(),
    setzeModus: vi.fn(),
    zerstoeren: controllerNachbau('griffe').zerstoeren,
  }),
}));
vi.mock('./zeichnen', async (original) => ({
  ...(await original<typeof import('./zeichnen')>()),
  createZeichnung: (_map: unknown, _f: unknown, _s: unknown, praefix: string) =>
    controllerNachbau(praefix),
}));

import Kartenflaeche, { type KartenflaecheProps } from './Kartenflaeche';

const STIL: StyleSpecification = { version: 8, sources: {}, layers: [] };
const polygon = (x: number): GeoJsonPolygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 50],
      [x + 0.1, 50],
      [x + 0.1, 50.1],
      [x, 50],
    ],
  ],
});

function zeige(props: Partial<KartenflaecheProps> = {}) {
  const alle: KartenflaecheProps = { style: STIL, markers: [], flaechen: [], ...props };
  const ansicht = render(<Kartenflaeche {...alle} />);
  return {
    ...ansicht,
    neu: (mehr: Partial<KartenflaecheProps>) =>
      ansicht.rerender(<Kartenflaeche {...alle} {...mehr} />),
  };
}

beforeEach(() => {
  karte.setDataAbschnitte = 0;
  karte.ereignisse = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('Kartenflaeche: Abbaureihenfolge beim Aushängen (LFH-943)', () => {
  it('baut laufende Werkzeuge und Griffe VOR map.remove() ab und wirft nicht', () => {
    const ecken: Ecken = [
      [8, 50],
      [8.1, 50],
      [8.1, 50.1],
      [8, 50.1],
    ];
    const { neu, unmount } = zeige();
    neu({ messen: 'strecke', zoneZeichnen: 'polygon' });
    neu({ messen: 'strecke', zoneZeichnen: 'polygon', zeichnen: true });
    neu({
      messen: 'strecke',
      zoneZeichnen: 'polygon',
      zeichnen: true,
      platzierBild: { id: 7, ecken },
    });

    expect(() => unmount()).not.toThrow();
    const remove = karte.ereignisse.indexOf('map.remove');
    expect(remove).toBeGreaterThan(-1);
    for (const name of ['messen', 'td-abschnitt', 'td-zone', 'griffe']) {
      const abbau = karte.ereignisse.indexOf(`${name}.zerstoeren`);
      expect(abbau, name).toBeGreaterThan(-1);
      expect(abbau, name).toBeLessThan(remove);
    }
  });
});

describe('Kartenflaeche: Abschnittsflächen nur bei Änderung (LFH-945)', () => {
  it('ein Rerender mit inhaltsgleichen Flächen und eine neue Eigenposition setzen nichts', () => {
    const flaechen = [{ id: 1, label: 'Abschnitt Nord', polygon: polygon(8) }];
    const { neu } = zeige({ flaechen });
    const nachStart = karte.setDataAbschnitte;

    // Neue Array-Identität, gleicher Inhalt — wie die Projektion einer Seite ohne useMemo.
    neu({ flaechen: flaechen.map((f) => ({ ...f })) });
    neu({
      flaechen: flaechen.map((f) => ({ ...f })),
      eigenposition: { lat: 50, lon: 8, genauigkeit: 12 },
    });
    expect(karte.setDataAbschnitte).toBe(nachStart);
  });

  it('eine geänderte Fläche wird genau einmal gesetzt', () => {
    const { neu } = zeige({ flaechen: [{ id: 1, label: 'Abschnitt Nord', polygon: polygon(8) }] });
    const nachStart = karte.setDataAbschnitte;

    neu({ flaechen: [{ id: 1, label: 'Abschnitt Nord', polygon: polygon(9) }] });
    expect(karte.setDataAbschnitte).toBe(nachStart + 1);
    neu({ flaechen: [{ id: 1, label: 'Abschnitt Süd', polygon: polygon(9) }] });
    expect(karte.setDataAbschnitte).toBe(nachStart + 2);
  });
});
