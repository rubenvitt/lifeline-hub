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
  // Hängen `_onMove`/`_onUp` an der Karte? maplibre meldet sie mit `remove()` ab: danach erreicht
  // kein Zeigerereignis des laufenden Zugs den Marker mehr.
  private zugHoerer = false;
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
    this.zugHoerer = false;
    return this;
  }
  on(ereignis: string, f: () => void) {
    this.listeners.set(ereignis, [...(this.listeners.get(ereignis) ?? []), f]);
    return this;
  }
  fire(ereignis: string) {
    for (const f of this.listeners.get(ereignis) ?? []) f();
  }
  /** Druck auf den Griff wie maplibres `_addDragHandler`: der Zug steht an, bewegt ist noch nichts. */
  press() {
    this._state = 'pending';
    this.zugHoerer = true;
  }
  /** Zeiger bewegen wie maplibres `_onMove`; nur mit angemeldeten Zug-Hörern. */
  moveTo(ziel: { lat: number; lon: number }) {
    if (!this.zugHoerer) return;
    this._isDragging = true;
    this.element.style.pointerEvents = 'none';
    this.setLngLat([ziel.lon, ziel.lat]);
    if (this._state === 'pending') {
      this._state = 'active';
      this.fire('dragstart');
    }
    this.fire('drag');
  }
  /** Zug beginnen: Druck, dann Zeiger durch den Griff hindurch (`dragstart`, `drag`). */
  startDrag(ziel: { lat: number; lon: number }) {
    this.press();
    this.moveTo(ziel);
  }
  /** Loslassen wie maplibres `_onUp`; nur mit angemeldeten Zug-Hörern. */
  endDrag() {
    if (!this.zugHoerer) return;
    this.zugHoerer = false;
    this._isDragging = false;
    this.element.style.pointerEvents = 'auto';
    if (this._state === 'active') this.fire('dragend');
    this._state = 'inactive';
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
  const onMitte = vi.fn<(mitte: GeoPunkt, fertig: boolean) => void>();
  const griff = erzeugeKreisGriff(karte, KONTEXT, onRadius, onMitte);
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
  return { griff, onRadius, onMitte, lage, dragTo, rand };
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

describe('Esc mitten im Zug am Kreis einer bestehenden Zone (LLH-1891)', () => {
  // Esc setzt Mitte und Radius auf den gespeicherten Kreis zurück. Die Mitte bleibt gesetzt, der
  // Griff hängt also nicht ab: die Seite beendet den Zug über `zugBeenden`, dann kommt `set`.
  const lageVon = (m: FakeMarker): GeoPunkt => {
    const ll = m.getLngLat()!;
    return { lat: ll.lat, lon: ll.lng };
  };

  it('Randgriff: Weiterziehen und Loslassen melden nichts, der Griff steht auf dem gespeicherten Kreis', () => {
    const { griff, onRadius, lage, rand } = setup();
    griff.set(MITTE, 300);
    rand.startDrag(noerdlich(MITTE, 500));
    griff.set(MITTE, onRadius.mock.lastCall![0]);
    onRadius.mockClear();

    griff.zugBeenden();
    griff.set(MITTE, 300);
    rand.moveTo(noerdlich(MITTE, 800));
    rand.endDrag();

    expect(onRadius).not.toHaveBeenCalled();
    expect(lage()).toEqual(griffLage(MITTE, 300));
    expect(rand.isGrabbable()).toBe(true);
  });

  it('Mittengriff: Weiterziehen und Loslassen melden nichts, beide Griffe stehen am gespeicherten Kreis', () => {
    const { griff, onMitte, onRadius, lage } = setup();
    const mittenGriff = marker.get('kreisgriff-mitte')!;
    griff.set(MITTE, 300);
    const gezogen = noerdlich(MITTE, 400);
    mittenGriff.startDrag(gezogen);
    griff.set(gezogen, 300);
    onMitte.mockClear();

    griff.zugBeenden();
    griff.set(MITTE, 300);
    mittenGriff.moveTo(noerdlich(MITTE, 900));
    mittenGriff.endDrag();

    expect(onMitte).not.toHaveBeenCalled();
    expect(onRadius).not.toHaveBeenCalled();
    expect(lageVon(mittenGriff)).toEqual(MITTE);
    expect(lage()).toEqual(griffLage(MITTE, 300));
    expect(mittenGriff.isGrabbable()).toBe(true);
  });

  it('ein Druck ohne Bewegung wird nach Esc nicht mehr zum Zug', () => {
    const { griff, onRadius, lage, rand } = setup();
    griff.set(MITTE, 300);
    rand.press();

    griff.zugBeenden();
    rand.moveTo(noerdlich(MITTE, 800));
    rand.endDrag();

    expect(onRadius).not.toHaveBeenCalled();
    expect(lage()).toEqual(griffLage(MITTE, 300));
    expect(rand.isGrabbable()).toBe(true);
  });

  it('ohne laufenden Zug ändert `zugBeenden` nichts, auch nicht an einem gezogenen Radius', () => {
    const { griff, onRadius, lage, dragTo, rand } = setup();
    griff.set(MITTE, 300);
    const ziel = noerdlich(MITTE, 220);
    const radius = dragTo(ziel);
    griff.set(MITTE, radius);
    onRadius.mockClear();

    griff.zugBeenden();

    expect(onRadius).not.toHaveBeenCalled();
    expect(lage()).toEqual(ziel);
    expect(rand.isGrabbable()).toBe(true);
  });
});
