import { useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';
import type { GeoPunkt } from './geo';

/**
 * Radius-Griff in der Kartenfläche (LLH-1700): wann die Lage des Griffs dem Stand der Seite folgt.
 * Die Karte ist ein Nachbau wie in `Kartenflaeche.ressourcen.test.tsx` (jede nicht nachgebaute
 * Methode ist ein stummer Spion), der Marker merkt sich Lage und Zuhörer.
 */
const griffe = vi.hoisted(() => new Map<string, FakeMarkerForm>());

interface FakeMarkerForm {
  setLngLat(ll: [number, number]): unknown;
  getLngLat(): { lng: number; lat: number } | undefined;
  fire(ereignis: string): void;
}

vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor() {
      const quellen = new Map<string, { setData: () => void }>();
      const ebenen = new Set<string>();
      const eigen: Record<string, unknown> = {
        style: { _loaded: true },
        getSource: (id: string) => quellen.get(id),
        addSource: (id: string) => quellen.set(id, { setData: () => {} }),
        getLayer: (id: string) => (ebenen.has(id) ? {} : undefined),
        addLayer: (spec: { id: string }) => ebenen.add(spec.id),
        getCanvas: () => document.createElement('canvas'),
        getContainer: () => document.createElement('div'),
        getStyle: () => ({ layers: [] }),
        once: (ev: string, cb: () => void) => {
          if (ev === 'style.load' || ev === 'load') cb();
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
  class FakeMarker implements FakeMarkerForm {
    private listeners = new Map<string, (() => void)[]>();
    // Wie bei maplibre: ohne `setLngLat` hat ein Marker keine Lage.
    private lngLat: { lng: number; lat: number } | undefined;
    constructor(opts?: { element?: HTMLElement }) {
      const kennung = opts?.element?.dataset.lfh;
      if (kennung) griffe.set(kennung, this);
    }
    setLngLat(ll: [number, number]) {
      this.lngLat = { lng: ll[0], lat: ll[1] };
      return this;
    }
    getLngLat() {
      return this.lngLat;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
    on(ereignis: string, f: () => void) {
      this.listeners.set(ereignis, [...(this.listeners.get(ereignis) ?? []), f]);
      return this;
    }
    fire(ereignis: string) {
      for (const f of this.listeners.get(ereignis) ?? []) f();
    }
  }
  class Leer {
    onAdd() {
      return document.createElement('div');
    }
    onRemove() {}
    remove() {}
    extend() {
      return this;
    }
  }
  const modul = {
    Map: FakeMap,
    AttributionControl: Leer,
    ScaleControl: Leer,
    Marker: FakeMarker,
    LngLatBounds: Leer,
    setWorkerUrl: vi.fn(),
    setWorkerCount: vi.fn(),
  };
  return { ...modul, default: modul };
});

vi.mock('./maplibreWorker', () => ({}));

import Kartenflaeche from './Kartenflaeche';
import { griffLage, radiusAusGriff } from './kreisVorschau';

const STIL: StyleSpecification = { version: 8, sources: {}, layers: [] };
const MITTE: GeoPunkt = { lat: 54, lon: 9.5 };

/** Der Punkt `nordM` Meter nördlich: ein Breitengrad misst überall rund 111,2 km. */
const noerdlich = (p: GeoPunkt, nordM: number): GeoPunkt => ({
  lat: p.lat + nordM / 111_195,
  lon: p.lon,
});

/** Läuft im Commit der Seite, also nach dem Commit der Kartenfläche und vor ihren passiven Effekten. */
const imCommit: { current: ((radiusM: number) => void) | null } = { current: null };

/** Eine Seite wie `LagekartePage`: sie hält den Radius und gibt ihn als Kreis an die Karte. */
function Seite() {
  const [radiusM, setRadiusM] = useState(300);
  useLayoutEffect(() => imCommit.current?.(radiusM));
  return (
    <Kartenflaeche
      style={STIL}
      markers={[]}
      flaechen={[]}
      kreis={{ mitte: MITTE, radiusM, farbe: '#d4380d' }}
      onKreisRadius={(r) => setRadiusM(r)}
    />
  );
}

afterEach(() => {
  imCommit.current = null;
  griffe.clear();
});

describe('Kartenflaeche: Radius-Griff nach dem Loslassen (LLH-1700)', () => {
  it('bleibt unter dem Zeiger, wenn Bewegung und Loslassen vor dem Effekt eines älteren Zieh-Radius kommen', () => {
    render(<Seite />);
    const rand = griffe.get('kreisgriff')!;
    const lage = (): GeoPunkt => {
      const ll = rand.getLngLat()!;
      return { lat: ll.lat, lon: ll.lng };
    };
    const lege = (p: GeoPunkt) => rand.setLngLat([p.lon, p.lat]);
    expect(lage()).toEqual(griffLage(MITTE, 300));

    const zwischen = noerdlich(MITTE, 250);
    const ziel = noerdlich(MITTE, 220);
    const radiusZwischen = radiusAusGriff(MITTE, zwischen);
    expect(radiusAusGriff(MITTE, ziel)).not.toBe(radiusZwischen);
    // Der Render des Zwischen-Radius ist committet, sein passiver Effekt steht noch aus: jetzt
    // kommen die letzte Bewegung und das Loslassen (unter Last liegen beide schon in der Schlange).
    let schonLosgelassen = false;
    imCommit.current = (radiusM) => {
      if (radiusM !== radiusZwischen || schonLosgelassen) return;
      schonLosgelassen = true;
      lege(ziel);
      rand.fire('drag');
      rand.fire('dragend');
    };

    act(() => {
      rand.fire('dragstart');
      lege(zwischen);
      rand.fire('drag');
    });

    expect(schonLosgelassen).toBe(true);
    expect(lage()).toEqual(ziel);
  });

  it('legt den Griff in den Osten, wenn die Seite einen anderen Radius setzt', () => {
    let setRadius: (r: number) => void = () => {};
    function SeiteMitBand() {
      const [radiusM, setRadiusM] = useState(300);
      setRadius = setRadiusM;
      return (
        <Kartenflaeche
          style={STIL}
          markers={[]}
          flaechen={[]}
          kreis={{ mitte: MITTE, radiusM, farbe: '#d4380d' }}
        />
      );
    }
    render(<SeiteMitBand />);
    const rand = griffe.get('kreisgriff')!;

    act(() => setRadius(500));

    const ost = griffLage(MITTE, 500);
    expect(rand.getLngLat()).toEqual({ lng: ost.lon, lat: ost.lat });
  });
});
