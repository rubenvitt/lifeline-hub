import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUECK_ZEILEN, setzeStueckweise, useStueckweise } from './stueckweise';

describe('useStueckweise (LLH-1974)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setzeStueckweise(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setzeStueckweise(false);
  });

  const lauf = (anzahl: number, aktiv = true) =>
    renderHook(({ anzahl, aktiv }) => useStueckweise(anzahl, aktiv), {
      initialProps: { anzahl, aktiv },
    });
  const weiter = () => act(() => vi.advanceTimersToNextTimer());

  it('liefert zuerst STUECK_ZEILEN, dann schrittweise alle', () => {
    expect(STUECK_ZEILEN).toBe(4);
    const { result } = lauf(10);
    expect(result.current).toBe(4);
    weiter();
    expect(result.current).toBe(8);
    weiter();
    expect(result.current).toBe(10);
  });

  it('stückelt nicht, wenn die Liste klein genug ist', () => {
    const { result } = lauf(4);
    expect(result.current).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stückelt nicht, wenn der Schalter aus ist', () => {
    setzeStueckweise(false);
    const { result } = lauf(10);
    expect(result.current).toBe(10);
  });

  it('stückelt nicht, wenn es beim ersten Anzeigen nicht aktiv ist', () => {
    const { result } = lauf(10, false);
    expect(result.current).toBe(10);
  });

  it('rendert alles, sobald aktiv falsch wird', () => {
    const { result, rerender } = lauf(10);
    expect(result.current).toBe(4);
    rerender({ anzahl: 10, aktiv: false });
    expect(result.current).toBe(10);
    rerender({ anzahl: 10, aktiv: true });
    expect(result.current).toBe(10);
  });

  it('bleibt bei einer schrumpfenden Liste nie über anzahl', () => {
    const { result, rerender } = lauf(10);
    weiter();
    rerender({ anzahl: 3, aktiv: true });
    expect(result.current).toBe(3);
  });

  it('zeigt nach Abschluss eine gewachsene Liste sofort ganz', () => {
    const { result, rerender } = lauf(10);
    weiter();
    weiter();
    rerender({ anzahl: 30, aktiv: true });
    expect(result.current).toBe(30);
  });
});
