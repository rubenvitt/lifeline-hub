import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { abstandM, radiusPunkt, type GeoPunkt } from './geo';
import { KREIS_RADIUS_M_MAX } from '../../api/eingabegrenzen';

/**
 * Der Radius-Griff gegen einen nachgebauten `maplibregl.Marker` (jsdom hat kein WebGL). Geprüft
 * wird, wo der Griff nach `set` steht: die `Kartenflaeche` ruft es im Commit, und der erste
 * Commit nach dem Loslassen bringt den zuletzt gezogenen Radius (LLH-1700).
 */
const marker = new Map<string, FakeMarker>();

class FakeMarker {
  private listeners = new Map<string, (() => void)[]>();
  // Wie bei maplibre: ohne `setLngLat` hat ein Marker keine Lage.
  private lngLat: { lng: number; lat: number } | undefined;
  constructor(opts: { element: HTMLElement }) {
    marker.set(opts.element.dataset.lfh ?? '?', this);
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

vi.mock('maplibre-gl', () => ({ Marker: FakeMarker }));

const { erzeugeKreisGriff, griffLage } = await import('./kreisVorschau');

const MITTE: GeoPunkt = { lat: 54, lon: 9.5 };
const KONTEXT = { controlHeight: 44, bedien: '#3b82f6' };
const karte = {} as MapLibreMap;

/** Der Punkt `nordM` Meter nördlich: ein Breitengrad misst überall rund 111,2 km. */
const noerdlich = (p: GeoPunkt, nordM: number): GeoPunkt => ({
  lat: p.lat + nordM / 111_195,
  lon: p.lon,
});

function setup() {
  const onRadius = vi.fn<(radiusM: number, fertig: boolean) => void>();
  const griff = erzeugeKreisGriff(karte, KONTEXT, onRadius, vi.fn());
  const rand = marker.get('kreisgriff')!;
  const lage = (): GeoPunkt => {
    const ll = rand.getLngLat()!;
    return { lat: ll.lat, lon: ll.lng };
  };
  /** Ein ganzer Zug des Griffs nach `ziel`; liefert den zuletzt gemeldeten Radius. */
  const ziehe = (ziel: GeoPunkt): number => {
    rand.fire('dragstart');
    rand.setLngLat([ziel.lon, ziel.lat]);
    rand.fire('drag');
    rand.fire('dragend');
    return onRadius.mock.lastCall![0];
  };
  return { griff, onRadius, lage, ziehe };
}

beforeEach(() => marker.clear());

describe('Radius-Griff nach dem Loslassen (LLH-1700)', () => {
  it('steht zuerst im Osten auf dem Rand', () => {
    const { griff, lage } = setup();
    griff.set(MITTE, 300);
    expect(lage()).toEqual(griffLage(MITTE, 300));
  });

  it('bleibt unter dem Zeiger, wenn der gezogene Radius erst nach dem Loslassen ankommt', () => {
    const { griff, onRadius, lage, ziehe } = setup();
    griff.set(MITTE, 300);
    // Nach Nordwesten gezogen: weit weg von der Ost-Lage des neuen Kreises.
    const ziel = noerdlich(radiusPunkt(MITTE, -150), 180);
    const radius = ziehe(ziel);
    expect(onRadius).toHaveBeenLastCalledWith(radius, true);
    expect(abstandM(ziel, griffLage(MITTE, radius))).toBeGreaterThan(200);

    griff.set(MITTE, radius);

    expect(lage()).toEqual(ziel);
  });

  it('bleibt auch stehen, wenn derselbe Stand noch einmal kommt (gleiche Mitte, gleicher Radius)', () => {
    const { griff, lage, ziehe } = setup();
    griff.set(MITTE, 300);
    const ziel = noerdlich(MITTE, 220);
    const radius = ziehe(ziel);
    griff.set(MITTE, radius);
    griff.set(MITTE, radius);
    expect(lage()).toEqual(ziel);
  });

  it('geht mit einem anderen Radius (Zahl im Band, Schnellwahl) wieder in den Osten', () => {
    const { griff, lage, ziehe } = setup();
    griff.set(MITTE, 300);
    const radius = ziehe(noerdlich(MITTE, 220));
    griff.set(MITTE, radius);

    griff.set(MITTE, 500);

    expect(lage()).toEqual(griffLage(MITTE, 500));
  });

  it('geht mit einer neuen Mitte in deren Osten, auch wenn die alte Lage denselben Radius ergäbe', () => {
    const { griff, lage } = setup();
    griff.set(MITTE, 300);
    // 5 m nach Norden: die alte Ost-Lage liegt 300,04 m von der neuen Mitte, gerundet also 300 m.
    const neu = noerdlich(MITTE, 5);
    expect(Math.round(abstandM(neu, lage()))).toBe(300);

    griff.set(neu, 300);

    expect(lage()).toEqual(griffLage(neu, 300));
  });

  it('bleibt jenseits der Obergrenze unter dem Zeiger, der Radius ist gekappt', () => {
    const { griff, lage, ziehe } = setup();
    griff.set(MITTE, 300);
    const ziel = noerdlich(MITTE, KREIS_RADIUS_M_MAX + 5_000);
    expect(ziehe(ziel)).toBe(KREIS_RADIUS_M_MAX);

    griff.set(MITTE, KREIS_RADIUS_M_MAX);

    expect(lage()).toEqual(ziel);
  });

  it('sitzt ohne Radius auf der Mitte und nach dem Abhängen wieder im Osten', () => {
    const { griff, lage, ziehe } = setup();
    griff.set(MITTE, null);
    expect(lage()).toEqual(MITTE);

    griff.set(MITTE, 300);
    const radius = ziehe(noerdlich(MITTE, 220));
    // Ohne Mitte hängt der Griff ab; ein neuer Kreis beginnt im Osten, nicht an der alten Lage.
    griff.set(null, null);
    griff.set(MITTE, radius);
    expect(lage()).toEqual(griffLage(MITTE, radius));
  });
});
