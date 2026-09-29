import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LEISTE_SPEICHER_SCHLUESSEL, leisteSichtbar, useLeistenWahl } from './leistenWahl';

afterEach(() => localStorage.clear());

describe('leisteSichtbar (LFH-715)', () => {
  it('ohne Wahl gilt die Vorgabe: ab lg offen, auf dem Tablet offen, auf dem Handschirm zu', () => {
    expect(leisteSichtbar({ gemerkt: null, breit: true, istSchmal: false, erzwungen: false })).toBe(
      true,
    );
    expect(
      leisteSichtbar({ gemerkt: null, breit: false, istSchmal: false, erzwungen: false }),
    ).toBe(true);
    expect(leisteSichtbar({ gemerkt: null, breit: false, istSchmal: true, erzwungen: false })).toBe(
      false,
    );
  });

  it('eine gemerkte Wahl schlägt die Vorgabe in beide Richtungen — auch ab lg', () => {
    expect(
      leisteSichtbar({ gemerkt: false, breit: true, istSchmal: false, erzwungen: false }),
    ).toBe(false);
    expect(leisteSichtbar({ gemerkt: true, breit: false, istSchmal: true, erzwungen: false })).toBe(
      true,
    );
    expect(
      leisteSichtbar({ gemerkt: false, breit: false, istSchmal: false, erzwungen: false }),
    ).toBe(false);
  });

  it('eine Auswahl oder ein Platzier-Modus erzwingt die Leiste gegen eine gemerkte Wahl', () => {
    expect(leisteSichtbar({ gemerkt: false, breit: true, istSchmal: false, erzwungen: true })).toBe(
      true,
    );
    expect(leisteSichtbar({ gemerkt: false, breit: false, istSchmal: true, erzwungen: true })).toBe(
      true,
    );
  });
});

describe('useLeistenWahl (LFH-715)', () => {
  it('liest je Breitenklasse ihren eigenen Platz', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.breit, '0');
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.schmal, '1');
    const { result, rerender } = renderHook(({ breit }) => useLeistenWahl(breit), {
      initialProps: { breit: true },
    });
    expect(result.current.wahl).toBe(false);
    rerender({ breit: false });
    expect(result.current.wahl).toBe(true);
  });

  it('ohne Eintrag ist nichts gewählt, und das Einhängen schreibt nichts', () => {
    const { result } = renderHook(() => useLeistenWahl(true));
    expect(result.current.wahl).toBeNull();
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBeNull();
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBeNull();
  });

  it('merkt eine Wahl nur in der Klasse, die beim Umschalten gilt', () => {
    const { result, rerender } = renderHook(({ breit }) => useLeistenWahl(breit), {
      initialProps: { breit: true },
    });
    act(() => result.current.merke(false));
    expect(result.current.wahl).toBe(false);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBeNull();

    rerender({ breit: false });
    expect(result.current.wahl).toBeNull();
    act(() => result.current.merke(true));
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBe('1');
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
  });

  it('`zeige` öffnet nur für die Sitzung: nichts gespeichert, nach dem Neuladen gilt die Wahl', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.breit, '0');
    const erst = renderHook(() => useLeistenWahl(true));
    act(() => erst.result.current.zeige());
    expect(erst.result.current.wahl).toBe(true);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
    erst.unmount();
    expect(renderHook(() => useLeistenWahl(true)).result.current.wahl).toBe(false);
  });

  it('nach `zeige` gewinnt das nächste eigene Umschalten', () => {
    const { result } = renderHook(() => useLeistenWahl(true));
    act(() => result.current.zeige());
    act(() => result.current.merke(false));
    expect(result.current.wahl).toBe(false);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
  });

  it('`zeige` gilt nur in der Klasse, in der es geschah', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.schmal, '0');
    const { result, rerender } = renderHook(({ breit }) => useLeistenWahl(breit), {
      initialProps: { breit: true },
    });
    act(() => result.current.zeige());
    rerender({ breit: false });
    expect(result.current.wahl).toBe(false);
  });

  // Die Wahl eines Zeichenwerkzeugs schließt die Leiste unter `lg` nur für die Sitzung — nach dem
  // Neuladen gilt wieder Vorgabe bzw. eigene Wahl.
  it('`verberge` schließt nur für die Sitzung: nichts gespeichert, nach dem Neuladen gilt die Wahl', () => {
    const erst = renderHook(() => useLeistenWahl(false));
    act(() => erst.result.current.verberge());
    expect(erst.result.current.wahl).toBe(false);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBeNull();
    erst.unmount();
    expect(renderHook(() => useLeistenWahl(false)).result.current.wahl).toBeNull();
  });

  it('nach `verberge` holt das eigene Einblenden die Leiste zurück, und `zeige` ebenso', () => {
    const { result } = renderHook(() => useLeistenWahl(false));
    act(() => result.current.verberge());
    act(() => result.current.merke(true));
    expect(result.current.wahl).toBe(true);
    act(() => result.current.verberge());
    expect(result.current.wahl).toBe(false);
    act(() => result.current.zeige());
    expect(result.current.wahl).toBe(true);
  });

  it('ein unlesbarer Eintrag gilt als keine Wahl', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.breit, 'kaputt');
    const { result } = renderHook(() => useLeistenWahl(true));
    expect(result.current.wahl).toBeNull();
  });
});
