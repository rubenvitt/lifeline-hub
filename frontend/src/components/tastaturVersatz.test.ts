import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTastaturVersatz } from './tastaturVersatz';

/** Gefälschtes VisualViewport: jsdom kennt keins. */
class FalschesViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
}

let vv: FalschesViewport | undefined;
let wurzel: HTMLDivElement;
let feld: HTMLInputElement;
let draussen: HTMLInputElement;

function setzeViewport(wert: FalschesViewport | undefined) {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: wert });
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  vv = new FalschesViewport();
  setzeViewport(vv);
  wurzel = document.createElement('div');
  feld = document.createElement('input');
  wurzel.appendChild(feld);
  draussen = document.createElement('input');
  document.body.append(wurzel, draussen);
});

afterEach(() => {
  wurzel.remove();
  draussen.remove();
  setzeViewport(undefined);
});

function tastaturAuf(hoehe: number) {
  act(() => {
    vv!.height = 844 - hoehe;
    vv!.dispatchEvent(new Event('resize'));
  });
}

describe('useTastaturVersatz (LLH-1761)', () => {
  it('ohne Fokus im Formular ist der Versatz 0', () => {
    const { result } = renderHook(() => useTastaturVersatz({ current: wurzel }));
    tastaturAuf(344);
    expect(result.current).toBe(0);
  });

  it('mit Fokus und offener Tastatur rückt der Versatz um die verdeckte Höhe', () => {
    const { result } = renderHook(() => useTastaturVersatz({ current: wurzel }));
    act(() => feld.focus());
    tastaturAuf(344);
    expect(result.current).toBe(344);
  });

  it('verlässt der Fokus das Formular, fällt der Versatz auf 0', () => {
    const { result } = renderHook(() => useTastaturVersatz({ current: wurzel }));
    act(() => feld.focus());
    tastaturAuf(344);
    act(() => draussen.focus());
    expect(result.current).toBe(0);
    tastaturAuf(300);
    expect(result.current).toBe(0);
  });

  it('steht der Fokus schon beim Einhängen im Formular, zählt er', () => {
    feld.focus();
    vv!.height = 500;
    const { result } = renderHook(() => useTastaturVersatz({ current: wurzel }));
    expect(result.current).toBe(344);
  });

  it('ohne VisualViewport bleibt der Versatz 0', () => {
    setzeViewport(undefined);
    const { result } = renderHook(() => useTastaturVersatz({ current: wurzel }));
    act(() => feld.focus());
    expect(result.current).toBe(0);
  });
});
