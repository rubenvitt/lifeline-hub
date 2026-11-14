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
  readonly element: HTMLElement;
  // Zugmerker wie bei maplibre: `remove()` setzt sie nicht zurück, nur `_onUp`.
  _isDragging = false;
  _state: 'inactive' | 'pending' | 'active' = 'inactive';
  constructor(opts: { element: HTMLElement }) {
    this.element = opts.element;
    marker.set(opts.element.dataset.lfh ?? '?', this);
  }
  setLngLat(ll: [number, number]) {
    this.lngLat = { lng: ll[0], lat: ll[1] };
    return this;
  }
  getLngLat() {
    return this.lngLat;
  }
  getElement() {
    return this.element;
  }
  addTo() {
    return this;
  }
  // Wie bei maplibre: `remove()` meldet die Zug-Hörer ab, ohne `dragend` zu feuern, und lässt
  // `pointer-events` am Element stehen.
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
  /** Zug beginnen wie maplibres `_onMove`: Zeiger durch den Griff hindurch, dann `dragstart`. */
  startDrag(ziel: { lat: number; lon: number }) {
    this._isDragging = true;
    this._state = 'active';
    this.element.style.pointerEvents = 'none';
    this.fire('dragstart');
    this.setLngLat([ziel.lon, ziel.lat]);
    this.fire('drag');
  }
  /** Zug beenden wie maplibres `_onUp`. */
  endDrag() {
    this._isDragging = false;
    this._state = 'inactive';
    this.element.style.pointerEvents = 'auto';
    this.fire('dragend');
  }
  /**
   * Greifbar: der Zeiger trifft das Element (maplibre schaltet es nur im Zug durchlässig), und kein
   * alter Zug steht noch. Sonst überspränge maplibre beim nächsten Druck die Klicktoleranz, und ein
   * Tipp mit 1–2 px Zittern würde zum Zug, dessen Klick auf der Karte die Mitte versetzt.
   */
  isGrabbable() {
    return (
      this.element.style.pointerEvents !== 'none' && !this._isDragging && this._state === 'inactive'
    );
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
  const dragTo = (ziel: GeoPunkt): number => {
    rand.startDrag(ziel);
    rand.endDrag();
    return onRadius.mock.lastCall![0];
  };
  return { griff, onRadius, lage, dragTo, rand };
}

beforeEach(() => marker.clear());

describe('Radius-Griff nach dem Loslassen (LLH-1700)', () => {
  it('steht zuerst im Osten auf dem Rand', () => {
    const { griff, lage } = setup();
    griff.set(MITTE, 300);
    expect(lage()).toEqual(griffLage(MITTE, 300));
  });

  it('bleibt unter dem Zeiger, wenn der gezogene Radius erst nach dem Loslassen ankommt', () => {
    const { griff, onRadius, lage, dragTo } = setup();
    griff.set(MITTE, 300);
    // Nach Nordwesten gezogen: weit weg von der Ost-Lage des neuen Kreises.
    const ziel = noerdlich(radiusPunkt(MITTE, -150), 180);
    const radius = dragTo(ziel);
    expect(onRadius).toHaveBeenLastCalledWith(radius, true);
    expect(abstandM(ziel, griffLage(MITTE, radius))).toBeGreaterThan(200);

    griff.set(MITTE, radius);

    expect(lage()).toEqual(ziel);
  });

  it('bleibt auch stehen, wenn derselbe Stand noch einmal kommt (gleiche Mitte, gleicher Radius)', () => {
    const { griff, lage, dragTo } = setup();
    griff.set(MITTE, 300);
    const ziel = noerdlich(MITTE, 220);
    const radius = dragTo(ziel);
    griff.set(MITTE, radius);
    griff.set(MITTE, radius);
    expect(lage()).toEqual(ziel);
  });

  it('geht mit einem anderen Radius (Zahl im Band, Schnellwahl) wieder in den Osten', () => {
    const { griff, lage, dragTo } = setup();
    griff.set(MITTE, 300);
    const radius = dragTo(noerdlich(MITTE, 220));
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
    const { griff, lage, dragTo } = setup();
    griff.set(MITTE, 300);
    const ziel = noerdlich(MITTE, KREIS_RADIUS_M_MAX + 5_000);
    expect(dragTo(ziel)).toBe(KREIS_RADIUS_M_MAX);

    griff.set(MITTE, KREIS_RADIUS_M_MAX);

    expect(lage()).toEqual(ziel);
  });

  it('sitzt ohne Radius auf der Mitte und nach dem Abhängen wieder im Osten', () => {
    const { griff, lage, dragTo } = setup();
    griff.set(MITTE, null);
    expect(lage()).toEqual(MITTE);

    griff.set(MITTE, 300);
    const radius = dragTo(noerdlich(MITTE, 220));
    // Ohne Mitte hängt der Griff ab; ein neuer Kreis beginnt im Osten, nicht an der alten Lage.
    griff.set(null, null);
    griff.set(MITTE, radius);
    expect(lage()).toEqual(griffLage(MITTE, radius));
  });
});

describe('Esc mitten im Zug (LLH-1857)', () => {
  // Esc verwirft die Mitte, die Kartenfläche ruft `set(null, …)`: maplibre nimmt den Griff ab,
  // ohne `dragend` zu feuern. Ein neuer Tipp setzt danach eine neue Mitte.
  const NEU = noerdlich(MITTE, 2_000);

  it('Randgriff: nach dem Abhängen im Zug steht er im Osten des neuen Kreises und ist greifbar', () => {
    const { griff, lage, rand } = setup();
    griff.set(MITTE, 300);
    rand.startDrag(noerdlich(MITTE, 220));

    griff.set(null, null);
    griff.set(NEU, 300);

    expect(lage()).toEqual(griffLage(NEU, 300));
    expect(rand.isGrabbable()).toBe(true);
  });

  it('Randgriff: ein neuer Kreis ohne Radius setzt ihn auf die neue Mitte', () => {
    const { griff, lage, rand } = setup();
    griff.set(MITTE, null);
    rand.startDrag(noerdlich(MITTE, 220));

    griff.set(null, null);
    griff.set(NEU, null);

    expect(lage()).toEqual(NEU);
    expect(rand.isGrabbable()).toBe(true);
  });

  it('Mittengriff: nach dem Abhängen im Zug steht er auf der neuen Mitte und ist greifbar', () => {
    const { griff } = setup();
    const mittenGriff = marker.get('kreisgriff-mitte')!;
    griff.set(MITTE, 300);
    mittenGriff.startDrag(noerdlich(MITTE, 120));

    griff.set(null, null);
    griff.set(NEU, 300);

    const ll = mittenGriff.getLngLat()!;
    expect({ lat: ll.lat, lon: ll.lng }).toEqual(NEU);
    expect(mittenGriff.isGrabbable()).toBe(true);
  });

  it('Mittengriff: auch wenn nur der Radius wegfällt, endet der Zug mit dem Abhängen', () => {
    const { griff } = setup();
    const mittenGriff = marker.get('kreisgriff-mitte')!;
    griff.set(MITTE, 300);
    mittenGriff.startDrag(noerdlich(MITTE, 120));

    // Ohne Radius steht kein Mittengriff (`mittenGriffSteht`).
    griff.set(MITTE, null);
    griff.set(NEU, 300);

    const ll = mittenGriff.getLngLat()!;
    expect({ lat: ll.lat, lon: ll.lng }).toEqual(NEU);
    expect(mittenGriff.isGrabbable()).toBe(true);
  });
});
