import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { GeoJsonGeometry } from './geo';
import type { BearbeitungsAktion, Lage } from './zonenBearbeitung';

/**
 * Griffe der punktweisen Bearbeitung gegen einen nachgebauten `maplibregl.Marker` (jsdom hat kein
 * WebGL). Der Nachbau hält die Zugmechanik von maplibre: `remove()` meldet die Zug-Hörer an der
 * Karte ab, danach erreicht kein Zeigerereignis des laufenden Zugs den Marker mehr.
 */
const marker: FakeMarker[] = [];

class FakeMarker {
  private listeners = new Map<string, (() => void)[]>();
  private lngLat: { lng: number; lat: number } | undefined;
  private zugHoerer = false;
  readonly element: HTMLElement;
  _isDragging = false;
  _state: 'inactive' | 'pending' | 'active' = 'inactive';
  angehaengt = false;
  constructor(opts: { element: HTMLElement }) {
    this.element = opts.element;
    marker.push(this);
  }
  get kennung() {
    return this.element.dataset.lfh;
  }
  setLngLat(ll: [number, number]) {
    this.lngLat = { lng: ll[0], lat: ll[1] };
    return this;
  }
  getLngLat() {
    return this.lngLat!;
  }
  getElement() {
    return this.element;
  }
  addTo() {
    this.angehaengt = true;
    return this;
  }
  remove() {
    this.angehaengt = false;
    this.zugHoerer = false;
    return this;
  }
  on(ereignis: string, f: () => void) {
    this.listeners.set(ereignis, [...(this.listeners.get(ereignis) ?? []), f]);
    return this;
  }
  private fire(ereignis: string) {
    for (const f of this.listeners.get(ereignis) ?? []) f();
  }
  press() {
    this._state = 'pending';
    this.zugHoerer = true;
  }
  moveTo(l: Lage) {
    if (!this.zugHoerer) return;
    this._isDragging = true;
    this.setLngLat(l);
    if (this._state === 'pending') {
      this._state = 'active';
      this.fire('dragstart');
    }
    this.fire('drag');
  }
  endDrag() {
    if (!this.zugHoerer) return;
    this.zugHoerer = false;
    this._isDragging = false;
    if (this._state === 'active') this.fire('dragend');
    this._state = 'inactive';
  }
}

vi.mock('maplibre-gl', () => ({ Marker: FakeMarker }));

const { erzeugeBearbeitungsGriffe } = await import('./zonenBearbeitungKarte');

/** Karte mit einer Quelle, deren letzter Stand mitgeschrieben wird; Pixel = Grad × 100 000. */
function karte() {
  let daten: unknown = null;
  const ebenen = new Set<string>();
  const map = {
    getSource: () => (daten ? { setData: (d: unknown) => (daten = d) } : undefined),
    addSource: (_id: string, q: { data: unknown }) => (daten = q.data),
    getLayer: (id: string) => (ebenen.has(id) ? {} : undefined),
    addLayer: (l: { id: string }) => ebenen.add(l.id),
    setPaintProperty: () => {},
    project: (p: Lage) => ({ x: p[0] * 100_000, y: -p[1] * 100_000 }),
    on: () => {},
    off: () => {},
  } as unknown as MapLibreMap;
  const vorschau = () =>
    (daten as { features: { geometry: GeoJsonGeometry }[] }).features[0]?.geometry ?? null;
  return { map, vorschau };
}

const ring = (ecken: Lage[]): GeoJsonGeometry => ({
  type: 'Polygon',
  coordinates: [[...ecken, ecken[0]]],
});
/** Das Gespeicherte: ein Quadrat von rund 1 km. */
const GESPEICHERT = ring([
  [9.5, 54],
  [9.51, 54],
  [9.51, 54.01],
  [9.5, 54.01],
]);
/** Ungespeichert geändert: die erste Ecke versetzt. */
const GEAENDERT = ring([
  [9.495, 53.995],
  [9.51, 54],
  [9.51, 54.01],
  [9.5, 54.01],
]);
const KONTEXT = { controlHeight: 44, bedien: '#3b82f6' };
const vorschauVon = (geometrie: GeoJsonGeometry) => ({ geometrie, gewaehlt: null, farbe: '#f00' });

beforeEach(() => {
  marker.length = 0;
});

describe('Esc mitten im Punktzug (LLH-1891)', () => {
  function setup() {
    const { map, vorschau } = karte();
    const melde = vi.fn<(a: BearbeitungsAktion) => void>();
    const griffe = erzeugeBearbeitungsGriffe(map, KONTEXT, melde);
    griffe.setze(vorschauVon(GEAENDERT));
    const ecke = () =>
      marker.find((m) => m.angehaengt && m.kennung === 'zonengriff' && m.getLngLat().lng === 9.51)!;
    const angehaengt = () => marker.filter((m) => m.angehaengt);
    return { griffe, melde, vorschau, ecke, angehaengt };
  }

  it('Weiterziehen und Loslassen melden nichts, Griffe und Vorschau zeigen den verworfenen Stand', () => {
    const { griffe, melde, vorschau, ecke, angehaengt } = setup();
    const gezogen = ecke();
    gezogen.press();
    gezogen.moveTo([9.53, 54.002]);
    expect(vorschau()).not.toEqual(GEAENDERT);

    // Esc: die Seite beendet den Zug, dann setzt das Verwerfen den gespeicherten Stand.
    griffe.zugBeenden();
    griffe.setze(vorschauVon(GESPEICHERT));
    gezogen.moveTo([9.54, 54.003]);
    gezogen.endDrag();

    expect(melde).not.toHaveBeenCalled();
    expect(vorschau()).toEqual(GESPEICHERT);
    expect(gezogen.angehaengt).toBe(false);
    // Die Eckgriffe stehen auf dem Gespeicherten, keiner hängt im Zug.
    const ecken = angehaengt()
      .filter((m) => m.kennung === 'zonengriff')
      .map((m) => [m.getLngLat().lng, m.getLngLat().lat]);
    expect(ecken).toEqual(GESPEICHERT.coordinates[0].slice(0, 4));
    expect(angehaengt().every((m) => m._state === 'inactive')).toBe(true);
  });

  it('auch ein Zwischengriff im Zug fügt nach Esc keinen Punkt ein', () => {
    const { griffe, melde, vorschau } = setup();
    const zwischen = marker.find((m) => m.angehaengt && m.kennung === 'zonengriff-zwischen')!;
    zwischen.press();
    zwischen.moveTo([9.52, 53.99]);

    griffe.zugBeenden();
    griffe.setze(vorschauVon(GESPEICHERT));
    zwischen.endDrag();

    expect(melde).not.toHaveBeenCalled();
    expect(vorschau()).toEqual(GESPEICHERT);
  });

  it('ohne Zug baut `zugBeenden` die Griffe unverändert neu auf', () => {
    const { griffe, melde, vorschau, angehaengt } = setup();
    const vorher = angehaengt().map((m) => [m.kennung, m.getLngLat().lng, m.getLngLat().lat]);

    griffe.zugBeenden();

    expect(melde).not.toHaveBeenCalled();
    expect(vorschau()).toEqual(GEAENDERT);
    expect(angehaengt().map((m) => [m.kennung, m.getLngLat().lng, m.getLngLat().lat])).toEqual(
      vorher,
    );
  });
});
