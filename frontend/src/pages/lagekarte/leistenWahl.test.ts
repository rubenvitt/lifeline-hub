import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LEISTE_SPEICHER_SCHLUESSEL, leisteSichtbar, useLeistenWahl } from './leistenWahl';

afterEach(() => localStorage.clear());

const OHNE_MODUS = { modusAktiv: false, imModus: null } as const;

describe('leisteSichtbar (LFH-715)', () => {
  it('ohne Wahl gilt die Vorgabe: ab lg offen, auf dem Tablet offen, auf dem Handschirm zu', () => {
    expect(
      leisteSichtbar({
        gemerkt: null,
        breit: true,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: null,
        breit: false,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: null,
        breit: false,
        istSchmal: true,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(false);
  });

  it('eine gemerkte Wahl schlägt die Vorgabe in beide Richtungen — auch ab lg', () => {
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: true,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(false);
    expect(
      leisteSichtbar({
        gemerkt: true,
        breit: false,
        istSchmal: true,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: false,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(false);
  });

  it('eine Auswahl oder ein Platzier-Modus erzwingt die Leiste gegen eine gemerkte Wahl', () => {
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: true,
        istSchmal: false,
        erzwungen: true,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: false,
        istSchmal: true,
        erzwungen: true,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
  });
});

// LFH-765: Unter `lg` gibt jeder Kartenmodus die Karte frei; danach gilt wieder, was vorher galt.
describe('leisteSichtbar im Kartenmodus (LFH-765)', () => {
  const basis = {
    gemerkt: true,
    breit: false,
    istSchmal: false,
    erzwungen: false,
    modusAktiv: true,
    imModus: null,
  } as const;

  it('unter lg schließt ein laufender Modus die Leiste gegen die gemerkte Wahl', () => {
    expect(leisteSichtbar(basis)).toBe(false);
  });

  it('ohne Modus gilt wieder die gemerkte Wahl', () => {
    expect(leisteSichtbar({ ...basis, modusAktiv: false })).toBe(true);
  });

  it('ab lg gibt ein Modus nichts frei', () => {
    expect(leisteSichtbar({ ...basis, breit: true })).toBe(true);
  });

  it('die vorläufige Wahl im Modus holt die Leiste zurück', () => {
    expect(leisteSichtbar({ ...basis, gemerkt: false, imModus: true })).toBe(true);
  });

  it('die vorläufige Wahl zählt nur im Modus', () => {
    expect(leisteSichtbar({ ...basis, modusAktiv: false, gemerkt: false, imModus: true })).toBe(
      false,
    );
  });

  it('erzwungen (Auswahl) gewinnt auch im Modus', () => {
    expect(leisteSichtbar({ ...basis, erzwungen: true, imModus: false })).toBe(true);
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

  it('ein unlesbarer Eintrag gilt als keine Wahl', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.breit, 'kaputt');
    const { result } = renderHook(() => useLeistenWahl(true));
    expect(result.current.wahl).toBeNull();
  });
});

describe('useLeistenWahl im Kartenmodus (LFH-765)', () => {
  it('`umschalteImModus` gilt nur bis zum Modusende und schreibt nichts', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.schmal, '0');
    const { result, rerender } = renderHook(({ modusAktiv }) => useLeistenWahl(false, modusAktiv), {
      initialProps: { modusAktiv: true },
    });
    expect(result.current.imModus).toBeNull();
    act(() => result.current.umschalteImModus(true));
    expect(result.current.imModus).toBe(true);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBe('0');
    rerender({ modusAktiv: false });
    expect(result.current.imModus).toBeNull();
    expect(result.current.wahl).toBe(false);
  });

  it('der nächste Modus startet ohne vorläufige Wahl', () => {
    const { result, rerender } = renderHook(({ modusAktiv }) => useLeistenWahl(false, modusAktiv), {
      initialProps: { modusAktiv: true },
    });
    act(() => result.current.umschalteImModus(true));
    rerender({ modusAktiv: false });
    rerender({ modusAktiv: true });
    expect(result.current.imModus).toBeNull();
  });

  it('das Modusende lässt `zeige` und die gemerkte Wahl stehen', () => {
    const { result, rerender } = renderHook(({ modusAktiv }) => useLeistenWahl(false, modusAktiv), {
      initialProps: { modusAktiv: false },
    });
    act(() => result.current.zeige());
    rerender({ modusAktiv: true });
    rerender({ modusAktiv: false });
    expect(result.current.wahl).toBe(true);
  });
});
