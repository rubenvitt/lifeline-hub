import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFunkprotokollLauf } from './useFunkprotokollLauf';

/*
 * Ein Dokument-Double: jsdom legt nicht aus. Höhe, Fenster und Bildlauf stehen hier, `scrollTo`
 * und `scrollBy` schreiben `scrollY`; die Oberkante einer Zeile ergibt sich aus ihrer Reihenfolge
 * (je 50 px) minus Bildlauf — so wie im Browser.
 */
const ZEILE = 50;
let hoehe = 2000;
let y = 0;
const fenster = 800;
let spalteUnten = 1500;

function zeilenOben(el: Element): number {
  const geschwister = [...(el.parentElement?.querySelectorAll('[data-zeile]') ?? [])];
  return geschwister.indexOf(el) * ZEILE - y;
}

beforeEach(() => {
  hoehe = 2000;
  y = 0;
  spalteUnten = 1500;
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => hoehe,
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: fenster });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  window.scrollTo = vi.fn((arg: ScrollToOptions | number) => {
    y = typeof arg === 'number' ? arg : (arg.top ?? y);
  }) as typeof window.scrollTo;
  window.scrollBy = vi.fn((arg: ScrollToOptions | number) => {
    y += typeof arg === 'number' ? arg : (arg.top ?? 0);
  }) as typeof window.scrollBy;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    // Die Spalte endet bei `spalteUnten` im Dokument; darunter stünde noch die Bilanz.
    if ((this as HTMLElement).dataset?.testid === 'spalte') {
      return {
        top: -y,
        bottom: spalteUnten - y,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
      } as DOMRect;
    }
    const oben = zeilenOben(this);
    return {
      top: oben,
      bottom: oben + ZEILE,
      left: 0,
      right: 0,
      width: 0,
      height: ZEILE,
    } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Liste(props: {
  zeilen: string[];
  bereit?: boolean;
  ohneStartlauf?: boolean;
  /** Ende an der Spalte statt am Dokument, mit angepinnter Erfassung. */
  mitSpalte?: boolean;
  kopfImFenster?: boolean;
  /** Noch keine Liste im DOM (die Seite zeigt ihr Skelett). */
  ohneWurzel?: boolean;
  onLauf?: (l: ReturnType<typeof useFunkprotokollLauf>) => void;
}) {
  const wurzel = useRef<HTMLOListElement>(null);
  const spalte = useRef<HTMLDivElement>(null);
  const lauf = useFunkprotokollLauf({
    wurzel,
    bereit: props.bereit ?? true,
    juengste: props.zeilen[props.zeilen.length - 1],
    aelteste: props.zeilen[0],
    ohneStartlauf: props.ohneStartlauf,
    kopfImFenster: props.kopfImFenster,
    ende: props.mitSpalte ? { spalte, fussVariable: '--test-fuss' } : undefined,
  });
  props.onLauf?.(lauf);
  return (
    <div ref={spalte} data-testid="spalte">
      <ol ref={props.ohneWurzel ? undefined : wurzel}>
        {props.zeilen.map((z) => (
          <li key={z} data-zeile={z}>
            {z}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Ein Bild weiter — der Startlauf rollt im zweiten Rahmen noch einmal ans Ende. */
async function naechsterRahmen() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

function bildlauf(nach: number) {
  y = nach;
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

describe('useFunkprotokollLauf (LLH-1149)', () => {
  it('rollt beim Öffnen ans Dokumentende', () => {
    render(<Liste zeilen={['a', 'b', 'c']} />);
    expect(y).toBe(2000);
  });

  it('rollt nicht, solange die Liste nicht steht, und nicht bei einem Sprungziel', () => {
    const { rerender } = render(<Liste zeilen={[]} bereit={false} />);
    expect(window.scrollTo).not.toHaveBeenCalled();
    rerender(<Liste zeilen={['a']} ohneStartlauf />);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('läuft am Ende einer neuen jüngsten Zeile nach', () => {
    const { rerender } = render(<Liste zeilen={['a', 'b']} />);
    hoehe = 2050;
    rerender(<Liste zeilen={['a', 'b', 'c']} />);
    expect(y).toBe(2050);
  });

  it('bleibt hochgerollt stehen und meldet „nicht am Ende“', async () => {
    let amEnde = true;
    const { rerender } = render(<Liste zeilen={['a', 'b']} onLauf={(l) => (amEnde = l.amEnde)} />);
    await naechsterRahmen();
    bildlauf(300);
    await naechsterRahmen();
    expect(amEnde).toBe(false);
    hoehe = 2050;
    rerender(<Liste zeilen={['a', 'b', 'c']} onLauf={(l) => (amEnde = l.amEnde)} />);
    expect(y).toBe(300);
  });

  it('hält die Lesestelle, wenn oben ältere Zeilen dazukommen', async () => {
    const { rerender } = render(<Liste zeilen={['c', 'd', 'e', 'f']} />);
    await naechsterRahmen();
    bildlauf(100); // oberste sichtbare Zeile: „e“ (Oberkante 0)
    await naechsterRahmen();
    rerender(<Liste zeilen={['a', 'b', 'c', 'd', 'e', 'f']} />);
    // Zwei Zeilen kamen darüber: „e“ stünde um 100 px tiefer, der Bildlauf folgt.
    expect(y).toBe(200);
  });

  it('rollt „zum Ende“ auf Wunsch und meldet es', () => {
    let lauf: ReturnType<typeof useFunkprotokollLauf> | undefined;
    render(<Liste zeilen={['a']} onLauf={(l) => (lauf = l)} />);
    y = 0;
    act(() => lauf!.zumEnde());
    expect(y).toBe(2000);
    expect(lauf!.amEnde).toBe(true);
  });

  it('rollt mit `ende` nur bis die Spalte über der Erfassung endet, nicht in die Bilanz darunter', async () => {
    document.documentElement.style.setProperty('--test-fuss', '100px');
    try {
      let amEnde = true;
      const { rerender } = render(
        <Liste zeilen={['a', 'b']} mitSpalte onLauf={(l) => (amEnde = l.amEnde)} />,
      );
      // Spalte endet bei 1500, das Fenster ist 800 hoch, die Erfassung 100: 1500 − 700.
      expect(y).toBe(800);
      await naechsterRahmen();
      expect(y).toBe(800);
      // Wer weiter in die Bilanz rollt, gilt als am Ende und wird beim Mitlaufen nicht
      // zurückgezogen; die neue Zeile verlängert die Spalte, ihr Ende bleibt im Bild.
      bildlauf(1000);
      await naechsterRahmen();
      expect(amEnde).toBe(true);
      spalteUnten = 1550;
      rerender(<Liste zeilen={['a', 'b', 'c']} mitSpalte onLauf={(l) => (amEnde = l.amEnde)} />);
      expect(y).toBe(1000);
    } finally {
      document.documentElement.style.removeProperty('--test-fuss');
    }
  });

  it('läuft nicht mit, wenn neuere Seiten in ein tiefes Fenster kommen („Neuere laden“)', async () => {
    const { rerender } = render(<Liste zeilen={['a', 'b']} kopfImFenster={false} />);
    await naechsterRahmen();
    const vorher = y;
    hoehe = 2100;
    rerender(<Liste zeilen={['a', 'b', 'c', 'd']} kopfImFenster />);
    expect(y).toBe(vorher);
    // Hält das Fenster den Kopf, läuft eine neue jüngste Zeile wieder mit.
    hoehe = 2150;
    rerender(<Liste zeilen={['a', 'b', 'c', 'd', 'e']} kopfImFenster />);
    expect(y).toBe(2150);
  });

  it('verbraucht den Startlauf nicht, solange die Liste nicht im DOM steht', () => {
    const { rerender } = render(<Liste zeilen={['a']} ohneWurzel />);
    expect(window.scrollTo).not.toHaveBeenCalled();
    rerender(<Liste zeilen={['a', 'b']} />);
    expect(y).toBe(2000);
  });

  it('schaltet die Ankerung des Browsers ab und gibt sie beim Aushängen zurück', () => {
    const { unmount } = render(<Liste zeilen={['a']} />);
    expect(document.documentElement.style.overflowAnchor).toBe('none');
    unmount();
    expect(document.documentElement.style.overflowAnchor).toBe('');
  });
});
