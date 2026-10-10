import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { useZeilenFehler } from './useZeilenFehler';

/**
 * Zeilenfehler je Schlüssel (LFH-1077). `useMutation` verfolgt nur den LETZTEN Aufruf: schreibt
 * Zeile A und gleich danach Zeile B, hinge A von der Mutation ab, und ihr Grund ginge verloren.
 * Die Callbacks der Mutation laufen dagegen für jeden Aufruf — dort merkt sich dieser Speicher
 * den Grund je Zeile.
 */
describe('useZeilenFehler (LFH-1077)', () => {
  const abgelehnt = new ApiError(409, 'Download läuft schon');

  it('merkt den Grund je Zeile, auch wenn danach eine andere Zeile schreibt', () => {
    const { result } = renderHook(() => useZeilenFehler<number>());
    act(() => {
      result.current.beginne(7);
      result.current.beginne(8);
      result.current.melde(7, abgelehnt, 'Löschen fehlgeschlagen');
    });
    expect(result.current.grund(7)).toEqual({
      fehler: abgelehnt,
      fallback: 'Löschen fehlgeschlagen',
    });
    expect(result.current.grund(8)).toBeNull();
  });

  it('räumt den Grund einer Zeile, sobald dort die nächste Aktion beginnt', () => {
    const { result } = renderHook(() => useZeilenFehler<number>());
    act(() => result.current.melde(7, abgelehnt));
    act(() => result.current.beginne(7));
    expect(result.current.grund(7)).toBeNull();
  });

  it('leert auf Wunsch alle Gründe', () => {
    const { result } = renderHook(() => useZeilenFehler<string>());
    act(() => {
      result.current.melde('a', abgelehnt);
      result.current.melde('b', abgelehnt);
    });
    act(() => result.current.leere());
    expect(result.current.grund('a')).toBeNull();
    expect(result.current.grund('b')).toBeNull();
  });

  it('nennt die Schlüssel mit Grund, damit ein Grund ohne gezeigte Zeile einen Ort findet', () => {
    const { result } = renderHook(() => useZeilenFehler<number>());
    expect(result.current.gemeldet()).toEqual([]);
    act(() => {
      result.current.melde(7, abgelehnt);
      result.current.melde(8, abgelehnt);
    });
    act(() => result.current.beginne(7));
    expect(result.current.gemeldet()).toEqual([8]);
  });

  it('behält stabile Funktionen über Renderläufe (taugt als Effekt-Abhängigkeit)', () => {
    const { result, rerender } = renderHook(() => useZeilenFehler<number>());
    const { beginne, melde, leere } = result.current;
    act(() => melde(1, abgelehnt));
    rerender();
    expect(result.current.beginne).toBe(beginne);
    expect(result.current.melde).toBe(melde);
    expect(result.current.leere).toBe(leere);
  });
});
