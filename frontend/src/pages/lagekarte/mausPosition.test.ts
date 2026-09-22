import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { erzeugeZeigerQuelle, useZeigerLage } from './mausPosition';

describe('Zeigerquelle', () => {
  it('meldet eine neue Lage an alle Abonnenten und liefert sie beim Lesen', () => {
    const q = erzeugeZeigerQuelle();
    const z = vi.fn();
    q.abonniere(z);
    q.melde({ lat: 50, lon: 8 });
    expect(z).toHaveBeenCalledTimes(1);
    expect(q.lies()).toEqual({ lat: 50, lon: 8 });
  });

  it('meldet einen ruhenden Zeiger nicht erneut — niemand soll dafür rendern', () => {
    const q = erzeugeZeigerQuelle();
    const z = vi.fn();
    q.abonniere(z);
    q.melde({ lat: 50, lon: 8 });
    q.melde({ lat: 50, lon: 8 });
    q.melde(null);
    q.melde(null);
    expect(z).toHaveBeenCalledTimes(2);
  });

  it('räumt ein Abo wieder ab', () => {
    const q = erzeugeZeigerQuelle();
    const z = vi.fn();
    const ab = q.abonniere(z);
    ab();
    q.melde({ lat: 1, lon: 2 });
    expect(z).not.toHaveBeenCalled();
  });

  it('versorgt die Anzeige über den Hook — und nur sie', () => {
    const q = erzeugeZeigerQuelle();
    const { result } = renderHook(() => useZeigerLage(q));
    expect(result.current).toBeNull();
    act(() => q.melde({ lat: 52.26, lon: 9.13 }));
    expect(result.current).toEqual({ lat: 52.26, lon: 9.13 });
    act(() => q.melde(null));
    expect(result.current).toBeNull();
  });
});
