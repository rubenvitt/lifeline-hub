import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKoordinatenSystemOverride, setzeOverride } from './koordinatenSystemStore';

afterEach(() => localStorage.clear());

describe('koordinatenSystemStore', () => {
  it('liefert null ohne gesetzten Override', () => {
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    expect(result.current).toBeNull();
  });
  it('setzen aktualisiert reaktiv und persistiert', () => {
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    act(() => setzeOverride('mgrs'));
    expect(result.current).toBe('mgrs');
    expect(localStorage.getItem('lifeline.koordinatensystem')).toBe('mgrs');
  });
  it('null löscht den Override', () => {
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    act(() => setzeOverride('utm'));
    act(() => setzeOverride(null));
    expect(result.current).toBeNull();
  });
  it('ignoriert unbekannte gespeicherte Werte', () => {
    localStorage.setItem('lifeline.koordinatensystem', 'quatsch');
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    expect(result.current).toBeNull();
  });
});
