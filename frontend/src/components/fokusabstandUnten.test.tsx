import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOKUSABSTAND_UNTEN, beobachteFussleiste, useFokusabstandUnten } from './fokusabstandUnten';

/**
 * Die gemeinsame Fokusabstand-Mechanik (LFH-373, aus LFH-465 gehoben). jsdom rechnet kein
 * Layout — geprüft wird deshalb die KOPPLUNG: gemessene Höhe + Abstand landet in der
 * Variable an der Wurzel, folgt einer Größenänderung und verschwindet beim Aushängen. Ob der
 * Browser damit wirklich freihält, belegen `e2e/befehl-aktionsleiste.spec.ts` und der
 * ETB-Lauf in `e2e/fokus-verdeckung.spec.ts`.
 */

let beobachterRueckruf: (() => void) | null = null;
const trennen = vi.fn();

beforeEach(() => {
  beobachterRueckruf = null;
  trennen.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(rueckruf: () => void) {
        beobachterRueckruf = rueckruf;
      }
      observe() {}
      disconnect() {
        trennen();
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty(FOKUSABSTAND_UNTEN);
});

function leisteMitHoehe(hoehe: { wert: number }) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ height: hoehe.wert }) as DOMRect;
  return el;
}

const wert = () => document.documentElement.style.getPropertyValue(FOKUSABSTAND_UNTEN);

describe('beobachteFussleiste', () => {
  it('schreibt Höhe plus Abstand an die Wurzel und folgt einer Größenänderung', () => {
    const hoehe = { wert: 78 };
    beobachteFussleiste(leisteMitHoehe(hoehe), 8);
    expect(wert()).toBe('86px');

    hoehe.wert = 184;
    beobachterRueckruf!();
    expect(wert()).toBe('192px');
  });

  it('räumt Variable und Beobachter beim Aushängen weg', () => {
    const aufraeumen = beobachteFussleiste(leisteMitHoehe({ wert: 78 }), 8);
    expect(wert()).toBe('86px');
    aufraeumen!();
    expect(wert()).toBe('');
    expect(trennen).toHaveBeenCalledTimes(1);
  });

  it('ohne Leiste passiert nichts', () => {
    expect(beobachteFussleiste(null, 8)).toBeUndefined();
    expect(wert()).toBe('');
  });
});

describe('useFokusabstandUnten', () => {
  function Seite({ zeigen }: { zeigen: boolean }) {
    const ref = useFokusabstandUnten(8);
    return zeigen ? <div ref={ref}>Leiste</div> : null;
  }

  it('hängt am Callback-Ref: Einhängen setzt, Aushängen räumt', () => {
    const { rerender } = render(<Seite zeigen />);
    // jsdom liefert Höhe 0 — die Kopplung zählt, nicht der Pixelwert.
    expect(wert()).toBe('8px');
    rerender(<Seite zeigen={false} />);
    expect(wert()).toBe('');
  });
});
