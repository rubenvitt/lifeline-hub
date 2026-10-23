import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  setzeZeitdarstellung,
  useZeitdarstellungGeraet,
  zeitdarstellungVergessenFuerTests,
} from './zeitDarstellungStore';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  zeitdarstellungVergessenFuerTests();
});

describe('zeitDarstellungStore (LLH-1053)', () => {
  it('ohne Wahl null — es gilt die Vorgabe', () => {
    const { result } = renderHook(() => useZeitdarstellungGeraet());
    expect(result.current).toBeNull();
  });
  it('setzen wirkt reaktiv und bleibt gespeichert', () => {
    const { result } = renderHook(() => useZeitdarstellungGeraet());
    act(() => setzeZeitdarstellung('datum_uhrzeit'));
    expect(result.current).toBe('datum_uhrzeit');
    expect(localStorage.getItem('lifeline.zeitdarstellung')).toBe('datum_uhrzeit');
  });
  it('null stellt auf die Vorgabe zurück', () => {
    const { result } = renderHook(() => useZeitdarstellungGeraet());
    act(() => setzeZeitdarstellung('taktisch'));
    act(() => setzeZeitdarstellung(null));
    expect(result.current).toBeNull();
    expect(localStorage.getItem('lifeline.zeitdarstellung')).toBeNull();
  });
  it('ignoriert unbekannte gespeicherte Werte (auch das alte 24h)', () => {
    localStorage.setItem('lifeline.zeitdarstellung', '24h');
    const { result } = renderHook(() => useZeitdarstellungGeraet());
    expect(result.current).toBeNull();
  });
});

describe('zeitDarstellungStore — Speicher voll oder gesperrt (LFH-942)', () => {
  it('Kontingent voll: die Wahl erreicht trotzdem jeden Abonnenten', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('voll', 'QuotaExceededError');
    });
    const a = renderHook(() => useZeitdarstellungGeraet());
    const b = renderHook(() => useZeitdarstellungGeraet());
    expect(() => act(() => setzeZeitdarstellung('datum_uhrzeit'))).not.toThrow();
    expect(a.result.current).toBe('datum_uhrzeit');
    expect(b.result.current).toBe('datum_uhrzeit');
  });
  it('localStorage ist null: Lesen liefert null, Setzen wirkt bis zum Neuladen', () => {
    vi.stubGlobal('localStorage', null);
    const { result } = renderHook(() => useZeitdarstellungGeraet());
    expect(result.current).toBeNull();
    act(() => setzeZeitdarstellung('datum_uhrzeit'));
    expect(result.current).toBe('datum_uhrzeit');
  });
});
