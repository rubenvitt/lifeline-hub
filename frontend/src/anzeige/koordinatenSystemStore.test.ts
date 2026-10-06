import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useKoordinatenSystemOverride,
  setzeOverride,
  koordinatenSystemVergessenFuerTests,
} from './koordinatenSystemStore';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  koordinatenSystemVergessenFuerTests();
});

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
    expect(localStorage.getItem('lifeline.koordinatensystem')).toBeNull();
  });
  it('ignoriert unbekannte gespeicherte Werte', () => {
    localStorage.setItem('lifeline.koordinatensystem', 'quatsch');
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    expect(result.current).toBeNull();
  });
});

describe('koordinatenSystemStore — Speicher voll oder gesperrt (LFH-942)', () => {
  it('Kontingent voll: die Wahl erreicht trotzdem jeden Abonnenten', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('voll', 'QuotaExceededError');
    });
    const a = renderHook(() => useKoordinatenSystemOverride());
    const b = renderHook(() => useKoordinatenSystemOverride());
    expect(() => act(() => setzeOverride('utm'))).not.toThrow();
    expect(a.result.current).toBe('utm');
    expect(b.result.current).toBe('utm');
  });

  it('Zurückstellen bei gesperrtem Speicher wirkt ebenso', () => {
    localStorage.setItem('lifeline.koordinatensystem', 'mgrs');
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    expect(result.current).toBe('mgrs');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    act(() => setzeOverride(null));
    expect(result.current).toBeNull();
  });

  it('localStorage ist null: Lesen liefert null, Setzen wirkt bis zum Neuladen', () => {
    vi.stubGlobal('localStorage', null);
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    expect(result.current).toBeNull();
    act(() => setzeOverride('dms'));
    expect(result.current).toBe('dms');
  });
});
