import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NACHLAUF_MS, erzeugeNachklickRiegel } from './nachklickRiegel';

/**
 * Nachklick-Riegel (LFH-776, D3): Der lange Druck öffnet das Kontextmenü, solange der Finger noch
 * liegt. Was der Browser danach schickt (natives `contextmenu` unter Android, Kompatibilitäts-
 * Mausereignisse und `click` beim Abheben), darf das Menü weder sofort schließen (rc-trigger hört
 * am `window` in der Capture-Phase auf `mousedown`/`contextmenu`) noch als Tipp auf der Karte landen.
 */
describe('erzeugeNachklickRiegel', () => {
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let spaeter: ReturnType<typeof vi.fn<(e: Event) => void>>;
  let riegel: ReturnType<typeof erzeugeNachklickRiegel>;
  const TYPEN = ['contextmenu', 'mousedown', 'mouseup', 'click'] as const;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);
    riegel = erzeugeNachklickRiegel(container);
    // Wie rc-trigger: NACH dem Riegel am `window` in der Capture-Phase angemeldet.
    spaeter = vi.fn<(e: Event) => void>();
    for (const t of TYPEN) window.addEventListener(t, spaeter, true);
  });

  afterEach(() => {
    for (const t of TYPEN) window.removeEventListener(t, spaeter, true);
    riegel.abbauen();
    container.remove();
    vi.useRealTimers();
  });

  const feuere = (typ: string, ziel: EventTarget = canvas) => {
    const e = new Event(typ, { bubbles: true, cancelable: true });
    ziel.dispatchEvent(e);
    return e;
  };

  it('ungeschärft läuft alles durch', () => {
    for (const t of TYPEN) feuere(t);
    expect(spaeter).toHaveBeenCalledTimes(TYPEN.length);
  });

  it('ohne liegenden Finger ist ein Kontextmenü ein Rechtsklick und schärft nicht', () => {
    expect(riegel.quelleFuerKontextmenue()).toBe('maus');
    for (const t of TYPEN) feuere(t);
    expect(spaeter).toHaveBeenCalledTimes(TYPEN.length);
  });

  it('mit liegendem Finger ist es ein langer Druck: Nachklicks erreichen niemanden mehr', () => {
    feuere('touchstart');
    expect(riegel.quelleFuerKontextmenue()).toBe('touch');
    const nativ = feuere('contextmenu');
    expect(nativ.defaultPrevented).toBe(true);
    feuere('touchend');
    for (const t of ['mousedown', 'mouseup', 'click']) {
      const e = feuere(t);
      expect(e.defaultPrevented).toBe(true);
    }
    expect(spaeter).not.toHaveBeenCalled();
  });

  it(`nach dem Abheben plus ${NACHLAUF_MS} ms läuft alles wieder durch`, () => {
    feuere('touchstart');
    riegel.quelleFuerKontextmenue();
    feuere('touchend');
    vi.advanceTimersByTime(NACHLAUF_MS - 1);
    feuere('click');
    expect(spaeter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    feuere('click');
    expect(spaeter).toHaveBeenCalledOnce();
  });

  it('ein neuer Finger löst den Riegel sofort: ein bewusster Tipp kommt an', () => {
    feuere('touchstart');
    riegel.quelleFuerKontextmenue();
    feuere('touchend');
    feuere('touchstart');
    feuere('touchend');
    feuere('click');
    expect(spaeter).toHaveBeenCalledOnce();
  });

  it('ein Finger im Menü (Portal außerhalb der Karte) löst den Riegel und zählt nicht als Karte', () => {
    const menue = document.createElement('div');
    document.body.appendChild(menue);
    feuere('touchstart');
    riegel.quelleFuerKontextmenue();
    feuere('touchend');
    feuere('touchstart', menue);
    expect(riegel.quelleFuerKontextmenue()).toBe('maus');
    feuere('touchend', menue);
    feuere('click', menue);
    expect(spaeter).toHaveBeenCalledOnce();
    menue.remove();
  });

  it('touchcancel zählt wie Abheben', () => {
    feuere('touchstart');
    riegel.quelleFuerKontextmenue();
    feuere('touchcancel');
    expect(riegel.quelleFuerKontextmenue()).toBe('maus');
    vi.advanceTimersByTime(NACHLAUF_MS);
    feuere('click');
    expect(spaeter).toHaveBeenCalledOnce();
  });

  it('abbauen nimmt alle Hörer weg', () => {
    feuere('touchstart');
    riegel.quelleFuerKontextmenue();
    riegel.abbauen();
    for (const t of TYPEN) feuere(t);
    expect(spaeter).toHaveBeenCalledTimes(TYPEN.length);
  });
});
