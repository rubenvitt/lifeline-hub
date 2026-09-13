import { describe, it, expect, vi } from 'vitest';
import { wendeKartenDatenAn } from './kartenDaten';

/**
 * Regressionsschutz für den „Zone verschwindet nach dem Zeichnen, erst nach Reload
 * sichtbar"-Bug: MapLibre verwirft setData still, solange der Style nicht geladen
 * ist (terra-draw baut beim Zeichnen Layer auf/ab). Die Anwendung muss dann auf den
 * ersten Frame mit geladenem Style nachgezogen werden — nicht still verworfen und
 * nicht erst bei `idle` (das kostete den Zeichner Sekunden).
 */
describe('wendeKartenDatenAn', () => {
  /** Minimale Karte mit den von wendeKartenDatenAn genutzten Methoden. */
  type FakeMap = Parameters<typeof wendeKartenDatenAn>[0];
  function fakeMap(istGeladen: () => boolean) {
    const handler: Record<string, Array<() => void>> = {};
    const map = {
      isStyleLoaded: istGeladen,
      on: vi.fn((ev: string, cb: () => void) => {
        (handler[ev] ??= []).push(cb);
      }),
      off: vi.fn((ev: string, cb: () => void) => {
        handler[ev] = (handler[ev] ?? []).filter((h) => h !== cb);
      }),
    };
    const feuere = (ev: string) => (handler[ev] ?? []).slice().forEach((h) => h());
    return { map: map as unknown as FakeMap, on: map.on, off: map.off, feuere };
  }

  it('wendet sofort an, wenn der Style geladen ist', () => {
    const anwenden = vi.fn();
    const { map, on } = fakeMap(() => true);
    wendeKartenDatenAn(map, anwenden);

    expect(anwenden).toHaveBeenCalledTimes(1);
    expect(on).not.toHaveBeenCalled();
  });

  it('vertagt auf den ersten render-Frame mit geladenem Style (verwirft NICHT)', () => {
    const anwenden = vi.fn();
    let geladen = false;
    const { map, on, off, feuere } = fakeMap(() => geladen);

    wendeKartenDatenAn(map, anwenden);

    // Kern des Bugs: NICHT sofort anwenden, aber auch nicht verlieren.
    expect(anwenden).not.toHaveBeenCalled();
    expect(on).toHaveBeenCalledWith('render', expect.any(Function));

    // Frame, während der Style noch lädt → weiter warten, nicht abmelden.
    feuere('render');
    expect(anwenden).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();

    // Erster Frame mit geladenem Style → anwenden und abmelden.
    geladen = true;
    feuere('render');
    expect(anwenden).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledWith('render', expect.any(Function));
  });
});
