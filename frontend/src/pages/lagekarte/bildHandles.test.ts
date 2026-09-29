import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ecken } from '../../api/kartenbilder';

/**
 * Verdrahtung der Bildgriffe gegen einen nachgebauten `maplibregl.Marker` (jsdom hat kein WebGL).
 * Geprüft wird, welche Griffe an der Karte hängen.
 */
const angehaengt = new Set<FakeMarker>();

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
    angehaengt.add(this);
    return this;
  }
  remove() {
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

const karte = {
  project: (ll: [number, number] | { lng: number; lat: number }) =>
    Array.isArray(ll) ? { x: ll[0] * 100, y: ll[1] * 100 } : { x: ll.lng * 100, y: ll.lat * 100 },
  unproject: (p: [number, number]) => ({ lng: p[0] / 100, lat: p[1] / 100 }),
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

describe('erzeugeBildHandles — Modus (LFH-711)', () => {
  beforeEach(() => angehaengt.clear());

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
