import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ecken } from '../../api/kartenbilder';

/**
 * Verdrahtung der Bildgriffe gegen einen nachgebauten `maplibregl.Marker` (jsdom hat kein WebGL).
 * Geprüft wird, welche Griffe an der Karte hängen.
 */
const angehaengt = new Set<FakeMarker>();
/** Wie oft Griffe an- und abgehängt wurden — MapLibres `addTo` hängt vorher ab (DOM-Arbeit). */
const domArbeit = { addTo: 0, remove: 0 };

class FakeMarker {
  private hoerer = new Map<string, (() => void)[]>();
  private lngLat = { lng: 0, lat: 0 };
  constructor(private opts: { element: HTMLElement }) {}
  getElement() {
    return this.opts.element;
  }
  setLngLat(ll: [number, number]) {
    this.lngLat = { lng: ll[0], lat: ll[1] };
    return this;
  }
  getLngLat() {
    return this.lngLat;
  }
  addTo() {
    domArbeit.addTo++;
    angehaengt.add(this);
    return this;
  }
  remove() {
    domArbeit.remove++;
    angehaengt.delete(this);
    return this;
  }
  on(ereignis: string, f: () => void) {
    this.hoerer.set(ereignis, [...(this.hoerer.get(ereignis) ?? []), f]);
    return this;
  }
  feuere(ereignis: string) {
    for (const f of this.hoerer.get(ereignis) ?? []) f();
  }
}

vi.mock('maplibre-gl', () => ({ Marker: FakeMarker }));
vi.mock('./bildLayer', () => ({ setzeBildGeometrie: vi.fn() }));

const { erzeugeBildHandles } = await import('./bildHandles');

/**
 * Nachgebaute Karte: `skala` Pixel je Grad, also ist das Einheitsbild `skala` px groß. Zoomen heißt
 * `skala` ändern und `move` feuern.
 */
const karte = {
  skala: 200,
  hoerer: new Map<string, Set<() => void>>(),
  project(ll: [number, number] | { lng: number; lat: number }) {
    const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
    return { x: lng * this.skala, y: lat * this.skala };
  },
  unproject(p: [number, number]) {
    return { lng: p[0] / this.skala, lat: p[1] / this.skala };
  },
  on(ereignis: string, f: () => void) {
    this.hoerer.set(ereignis, new Set([...(this.hoerer.get(ereignis) ?? []), f]));
  },
  off(ereignis: string, f: () => void) {
    this.hoerer.get(ereignis)?.delete(f);
  },
  feuere(ereignis: string) {
    for (const f of this.hoerer.get(ereignis) ?? []) f();
  },
};
const ECKEN: Ecken = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const KONTEXT = { controlHeight: 72, bedien: '#3b82f6' };

/** Die Griffarten, die gerade an der Karte hängen (aus der `data-lfh`-Marke des Elements). */
function scharf(): string[] {
  return [...angehaengt].map((m) => m.getElement().dataset.lfh ?? '?').sort();
}
function griffe(art: string): FakeMarker[] {
  return [...angehaengt].filter((m) => m.getElement().dataset.lfh === `bildgriff-${art}`);
}

function vorher() {
  angehaengt.clear();
  domArbeit.addTo = 0;
  domArbeit.remove = 0;
  karte.skala = 200;
  karte.hoerer.clear();
}

describe('erzeugeBildHandles — Modus (LFH-711)', () => {
  beforeEach(vorher);

  it('hängt je Modus nur die passende Griffsorte an die Karte', () => {
    const h = erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'groesse');
    expect(scharf()).toEqual([
      ...Array(4).fill('bildgriff-eck'),
      ...Array(4).fill('bildgriff-kante'),
    ]);
    h.setzeModus('drehen');
    expect(scharf()).toEqual(['bildgriff-dreh']);
    h.setzeModus('verschieben');
    expect(scharf()).toEqual(['bildgriff-mitte']);
    h.zerstoeren();
    expect(scharf()).toEqual([]);
  });

  it('baut jeden Griff in Stufengröße mit Kern in der Rolle `bedien`', () => {
    erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'drehen');
    const el = griffe('dreh')[0].getElement();
    expect(el.style.width).toBe('72px');
    expect(el.style.height).toBe('72px');
    expect((el.firstElementChild as HTMLElement).style.background).toBe('rgb(59, 130, 246)');
  });

  it('stellt einen Wechsel mitten in der Ziehgeste bis `dragend` zurück — die Geste wird gespeichert', () => {
    const onCommit = vi.fn();
    const h = erzeugeBildHandles(karte as never, 1, ECKEN, onCommit, KONTEXT, 'verschieben');
    const mitte = griffe('mitte')[0];
    mitte.feuere('dragstart');
    h.setzeModus('drehen');
    // Der gezogene Griff hängt noch: abgezogen, meldete MapLibre seinen `mouseup`-Hörer ab.
    expect(scharf()).toEqual(['bildgriff-mitte']);
    mitte.feuere('dragend');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(scharf()).toEqual(['bildgriff-dreh']);
  });

  it('ohne Geste wirkt der Wechsel sofort', () => {
    const h = erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'verschieben');
    const mitte = griffe('mitte')[0];
    mitte.feuere('dragstart');
    mitte.feuere('dragend');
    h.setzeModus('groesse');
    expect(scharf()).toHaveLength(8);
  });
});

/**
 * Griffwahl nach der Darstellung (LFH-764): Kanten nur mit Platz. Das Einheitsbild ist bei
 * `skala` 100 genau 100 px groß — bei Griffkante 72 liegen Ecke und Kantenmitte 50 px auseinander.
 */
describe('erzeugeBildHandles — Griffwahl nach Platz (LFH-764)', () => {
  beforeEach(vorher);
  const eckUndKante = [...Array(4).fill('bildgriff-eck'), ...Array(4).fill('bildgriff-kante')];

  it('hält auf einem kleinen Bild nur die Ecken scharf und meldet das', () => {
    karte.skala = 100;
    const onStand = vi.fn();
    erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'groesse', onStand);
    expect(scharf()).toEqual(Array(4).fill('bildgriff-eck'));
    expect(onStand).toHaveBeenLastCalledWith({ kantenAus: 'alle' });
  });

  it('entscheidet bei jeder Kartenbewegung neu und meldet nur Wechsel', () => {
    karte.skala = 100;
    const onStand = vi.fn();
    erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'groesse', onStand);
    karte.skala = 200;
    karte.feuere('move');
    expect(scharf()).toEqual(eckUndKante);
    expect(onStand).toHaveBeenLastCalledWith({ kantenAus: 'keine' });
    const aufrufe = onStand.mock.calls.length;
    karte.feuere('move');
    expect(onStand).toHaveBeenCalledTimes(aufrufe);
    karte.skala = 100;
    karte.feuere('move');
    expect(scharf()).toEqual(Array(4).fill('bildgriff-eck'));
  });

  it('fasst bei einer Kartenbewegung ohne Mengenwechsel das DOM nicht an', () => {
    // `move` feuert je Frame; `addTo` an einem hängenden Marker hinge ihn ab und wieder an.
    erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'groesse');
    domArbeit.addTo = 0;
    domArbeit.remove = 0;
    karte.skala = 210;
    karte.feuere('move');
    karte.feuere('move');
    expect(domArbeit).toEqual({ addTo: 0, remove: 0 });
  });

  it('zieht während eines Zugs nichts ab; erst `dragend` entscheidet neu', () => {
    erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'groesse');
    const ecke = griffe('eck')[0];
    ecke.feuere('dragstart');
    karte.skala = 100;
    karte.feuere('move');
    // Ein abgezogener Griff verlöre seinen `mouseup`-Hörer mitten in der Geste (LFH-711).
    expect(scharf()).toEqual(eckUndKante);
    ecke.feuere('dragend');
    expect(scharf()).toEqual(Array(4).fill('bildgriff-eck'));
  });

  it('entscheidet nach dem Umschalten auf „Größe" nach dem aktuellen Platz', () => {
    const h = erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'drehen');
    karte.skala = 100;
    karte.feuere('move');
    h.setzeModus('groesse');
    expect(scharf()).toEqual(Array(4).fill('bildgriff-eck'));
  });

  it('entscheidet nach Ecken von außen neu (Refetch, numerische Eingabe)', () => {
    const h = erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'groesse');
    expect(scharf()).toEqual(eckUndKante);
    // Halb so groß: 100 px bei `skala` 200.
    h.setzeEcken([
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [0, 0.5],
    ]);
    expect(scharf()).toEqual(Array(4).fill('bildgriff-eck'));
  });

  it('meldet den Kartenhörer beim Zerstören ab', () => {
    const h = erzeugeBildHandles(karte as never, 1, ECKEN, vi.fn(), KONTEXT, 'groesse');
    expect(karte.hoerer.get('move')?.size).toBe(1);
    h.zerstoeren();
    expect(karte.hoerer.get('move')?.size ?? 0).toBe(0);
  });
});
