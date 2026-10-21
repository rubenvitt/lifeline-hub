import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';

/**
 * Kartenfläche auf einem Gerät ohne WebGL2 (LLH-1353): maplibres Konstruktor wirft dort eine
 * `GPUInitializationError`. Die Fläche zeigt den Zustand statt die Seite in die Fehlerseite der
 * App zu reißen; jeder andere Wurf fliegt weiter. Der Nachbau wirft wie maplibre 6 (`name` gesetzt,
 * Klasse nicht exportiert wie in den übrigen Nachbauten).
 *
 * Mutationsprobe: Fang im Karten-Effekt weg → der erste Fall wirft beim Rendern, rot; Fang ohne
 * `isGrafikFehler` (alles fangen) → der letzte Fall wirft nicht, rot (geprobt 21.10.).
 */
const karte = vi.hoisted(() => ({ wurf: null as null | (() => Error) }));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor() {
      if (karte.wurf) throw karte.wurf();
      // Mit Karte: jede nicht nachgebaute Methode ist ein stummer Spion (wie
      // `Kartenflaeche.ressourcen.test.tsx`).
      const eigen: Record<string, unknown> = {
        style: { _loaded: true },
        getSource: () => undefined,
        getLayer: () => undefined,
        getCanvas: () => document.createElement('canvas'),
        getContainer: () => document.createElement('div'),
        getStyle: () => ({ layers: [] }),
        getLayersOrder: () => [],
        once: () => {},
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
  }
  const modul = {
    Map: FakeMap,
    AttributionControl: Leer,
    ScaleControl: Leer,
    Marker: Leer,
    setWorkerUrl: vi.fn(),
    setWorkerCount: vi.fn(),
  };
  return { ...modul, default: modul };
});
vi.mock('./maplibreWorker', () => ({}));

import Kartenflaeche, { type KartenHandle } from './Kartenflaeche';

const STIL: StyleSpecification = { version: 8, sources: {}, layers: [] };

function grafikFehler() {
  const f = new Error('WebGL2 is required to display this map.');
  f.name = 'GPUInitializationError';
  return f;
}

afterEach(() => {
  karte.wurf = null;
});

describe('Kartenflaeche ohne WebGL2 (LLH-1353)', () => {
  it('zeigt den Zustand an Stelle der Karte und wirft nicht', () => {
    karte.wurf = grafikFehler;
    const ref = createRef<KartenHandle>();
    expect(() => render(<Kartenflaeche ref={ref} style={STIL} markers={[]} />)).not.toThrow();

    const zustand = screen.getByRole('status');
    expect(zustand).toHaveTextContent('Karte auf diesem Gerät nicht darstellbar');
    expect(zustand).toHaveAttribute('data-lfh', 'karte-nicht-darstellbar');
    expect(screen.queryByText(/webgl/i)).toBeNull();
  });

  it('der Handle sagt es, die Aufnahme liefert kein Bild, Bedienung tut nichts', async () => {
    karte.wurf = grafikFehler;
    const ref = createRef<KartenHandle>();
    render(<Kartenflaeche ref={ref} style={STIL} markers={[]} />);

    expect(ref.current!.isDarstellbar()).toBe(false);
    await expect(ref.current!.nimmBildAuf()).resolves.toBeNull();
    expect(() => {
      ref.current!.zoomRein();
      ref.current!.nachNorden();
    }).not.toThrow();
  });

  it('mit Karte kein Zustand, der Handle meldet darstellbar', () => {
    const ref = createRef<KartenHandle>();
    render(<Kartenflaeche ref={ref} style={STIL} markers={[]} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(ref.current!.isDarstellbar()).toBe(true);
  });

  it('ein anderer Fehler des Konstruktors bleibt ein Fehler', () => {
    karte.wurf = () => new TypeError('container is undefined');
    // React meldet den Wurf zusätzlich auf der Konsole; der Test prüft nur, dass er fliegt.
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Kartenflaeche style={STIL} markers={[]} />)).toThrow(
        'container is undefined',
      );
    } finally {
      konsole.mockRestore();
    }
  });
});
