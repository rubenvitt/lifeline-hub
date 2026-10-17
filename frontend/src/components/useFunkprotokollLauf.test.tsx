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

function zeilenOben(el: Element): number {
  const geschwister = [...(el.parentElement?.querySelectorAll('[data-zeile]') ?? [])];
  return geschwister.indexOf(el) * ZEILE - y;
}

beforeEach(() => {
  hoehe = 2000;
  y = 0;
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
  onLauf?: (l: ReturnType<typeof useFunkprotokollLauf>) => void;
}) {
  const wurzel = useRef<HTMLOListElement>(null);
  const lauf = useFunkprotokollLauf({
    wurzel,
    bereit: props.bereit ?? true,
    juengste: props.zeilen[props.zeilen.length - 1],
    aelteste: props.zeilen[0],
    ohneStartlauf: props.ohneStartlauf,
  });
  props.onLauf?.(lauf);
  return (
    <ol ref={wurzel}>
      {props.zeilen.map((z) => (
        <li key={z} data-zeile={z}>
          {z}
        </li>
      ))}
    </ol>
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

  it('schaltet die Ankerung des Browsers ab und gibt sie beim Aushängen zurück', () => {
    const { unmount } = render(<Liste zeilen={['a']} />);
    expect(document.documentElement.style.overflowAnchor).toBe('none');
    unmount();
    expect(document.documentElement.style.overflowAnchor).toBe('');
  });
});
