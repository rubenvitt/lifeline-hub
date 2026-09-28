import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  eigenpositionVerfuegbarkeit,
  EIGENPOSITION_SPERRGRUND,
  useEigenposition,
} from './useEigenposition';

type Erfolg = (p: GeolocationPosition) => void;
type Fehler = (e: GeolocationPositionError) => void;

/** Nachgebaute Standortquelle: hält die Rückrufe, damit der Test Positionen einspielen kann. */
function geoStub() {
  let ok: Erfolg | null = null;
  let err: Fehler | null = null;
  const watchPosition = vi.fn((o: Erfolg, e: Fehler) => {
    ok = o;
    err = e;
    return 7;
  });
  const clearWatch = vi.fn();
  const melde = (lat: number, lon: number, genauigkeit = 20) =>
    act(() =>
      ok?.({
        coords: { latitude: lat, longitude: lon, accuracy: genauigkeit },
        timestamp: 0,
      } as GeolocationPosition),
    );
  const scheitere = (code: 1 | 2 | 3) =>
    act(() =>
      err?.({
        code,
        message: '',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError),
    );
  return { geo: { watchPosition, clearWatch }, watchPosition, clearWatch, melde, scheitere };
}

const ursprung = {
  sicher: Object.getOwnPropertyDescriptor(window, 'isSecureContext'),
  geo: Object.getOwnPropertyDescriptor(navigator, 'geolocation'),
};

function setze(sicher: boolean, geo: unknown) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: sicher });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
}

let stub: ReturnType<typeof geoStub>;
beforeEach(() => {
  stub = geoStub();
  setze(true, stub.geo);
});
afterEach(() => {
  if (ursprung.sicher) Object.defineProperty(window, 'isSecureContext', ursprung.sicher);
  else delete (window as { isSecureContext?: boolean }).isSecureContext;
  if (ursprung.geo) Object.defineProperty(navigator, 'geolocation', ursprung.geo);
  else delete (navigator as { geolocation?: unknown }).geolocation;
});

describe('eigenpositionVerfuegbarkeit (LFH-712)', () => {
  it('bereit nur mit sicherem Kontext UND Standortquelle', () => {
    expect(eigenpositionVerfuegbarkeit()).toBe('bereit');
    setze(false, stub.geo);
    expect(eigenpositionVerfuegbarkeit()).toBe('unsicher');
    setze(true, undefined);
    expect(eigenpositionVerfuegbarkeit()).toBe('fehlt');
  });

  it('nennt für jede Sperre einen Grund', () => {
    expect(EIGENPOSITION_SPERRGRUND.unsicher).toMatch(/https/);
    expect(EIGENPOSITION_SPERRGRUND.fehlt).toBeTruthy();
  });
});

describe('useEigenposition (LFH-712)', () => {
  it('fragt ohne Einschalten nichts an', () => {
    renderHook(() => useEigenposition({ onFehler: vi.fn(), onErsterFix: vi.fn() }));
    expect(stub.watchPosition).not.toHaveBeenCalled();
  });

  it('an → Position; aus → Uhr geräumt und Punkt weg', () => {
    const { result } = renderHook(() =>
      useEigenposition({ onFehler: vi.fn(), onErsterFix: vi.fn() }),
    );
    act(() => result.current.umschalten());
    expect(result.current.an).toBe(true);
    expect(stub.watchPosition).toHaveBeenCalledTimes(1);
    stub.melde(52.1, 9.3, 15);
    expect(result.current.position).toEqual({ lat: 52.1, lon: 9.3, genauigkeit: 15 });

    act(() => result.current.umschalten());
    expect(result.current.an).toBe(false);
    expect(result.current.position).toBeNull();
    expect(stub.clearWatch).toHaveBeenCalledWith(7);
  });

  it('räumt die Uhr beim Aushängen', () => {
    const { result, unmount } = renderHook(() =>
      useEigenposition({ onFehler: vi.fn(), onErsterFix: vi.fn() }),
    );
    act(() => result.current.umschalten());
    unmount();
    expect(stub.clearWatch).toHaveBeenCalledWith(7);
  });

  it('fliegt nur beim ersten Standort je Einschalten an', () => {
    const onErsterFix = vi.fn();
    const { result } = renderHook(() => useEigenposition({ onFehler: vi.fn(), onErsterFix }));
    act(() => result.current.umschalten());
    stub.melde(52.1, 9.3);
    stub.melde(52.2, 9.4);
    expect(onErsterFix).toHaveBeenCalledTimes(1);
    expect(onErsterFix).toHaveBeenCalledWith({ lat: 52.1, lon: 9.3, genauigkeit: 20 });

    act(() => result.current.umschalten());
    act(() => result.current.umschalten());
    stub.melde(53, 10);
    expect(onErsterFix).toHaveBeenCalledTimes(2);
  });

  it('ohne sicheren Kontext: Umschalten tut nichts, keine Anfrage', () => {
    setze(false, stub.geo);
    const { result } = renderHook(() =>
      useEigenposition({ onFehler: vi.fn(), onErsterFix: vi.fn() }),
    );
    expect(result.current.verfuegbarkeit).toBe('unsicher');
    act(() => result.current.umschalten());
    expect(result.current.an).toBe(false);
    expect(stub.watchPosition).not.toHaveBeenCalled();
  });

  it('verweigerte Berechtigung: aus und Meldung mit Hinweis auf die Freigabe', () => {
    const onFehler = vi.fn();
    const { result } = renderHook(() => useEigenposition({ onFehler, onErsterFix: vi.fn() }));
    act(() => result.current.umschalten());
    stub.scheitere(1);
    expect(result.current.an).toBe(false);
    expect(onFehler).toHaveBeenCalledWith(expect.stringMatching(/freigeben/));
  });

  it('kein Standort vor dem ersten Fix: aus und Meldung', () => {
    const onFehler = vi.fn();
    const { result } = renderHook(() => useEigenposition({ onFehler, onErsterFix: vi.fn() }));
    act(() => result.current.umschalten());
    stub.scheitere(3);
    expect(result.current.an).toBe(false);
    expect(onFehler).toHaveBeenCalledWith(expect.stringMatching(/kein Standort/i));
  });

  it('ein Aussetzer NACH dem ersten Fix behält die letzte Position und bleibt an', () => {
    const onFehler = vi.fn();
    const { result } = renderHook(() => useEigenposition({ onFehler, onErsterFix: vi.fn() }));
    act(() => result.current.umschalten());
    stub.melde(52.1, 9.3);
    stub.scheitere(3);
    expect(result.current.an).toBe(true);
    expect(result.current.position?.lat).toBe(52.1);
    expect(onFehler).not.toHaveBeenCalled();
  });

  it('schreibt nichts in den Browser-Speicher', () => {
    const { result } = renderHook(() =>
      useEigenposition({ onFehler: vi.fn(), onErsterFix: vi.fn() }),
    );
    const vorher = localStorage.length;
    act(() => result.current.umschalten());
    stub.melde(52.1, 9.3);
    expect(localStorage.length).toBe(vorher);
    expect(sessionStorage.length).toBe(0);
  });
});
