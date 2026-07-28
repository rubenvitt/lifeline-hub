import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { abBreiteAus, useViewport } from './useViewport';
import {
  erfassteQueries,
  sendeZeigerAenderung,
  setzeViewportBreite,
  setzeZeigerGrob,
} from '../test/viewport';

/**
 * Breiten- und Zeigerachse des Viewport-Hooks (LFH-329 · B1/H24).
 *
 * Die Breite wird jeweils VOR dem Render gesetzt: antds Beobachter ruft seinen Zuhörer
 * beim Abonnieren synchron auf und liest dabei nur `matches` — ein nachträglich gefeuertes
 * Ereignis erreicht ihn nicht mehr.
 */

describe('useViewport (LFH-329 · H24)', () => {
  it('useViewport: bei 390 px ist istSchmal wahr, bei 1024 px nicht', () => {
    setzeViewportBreite(390);
    const schmal = renderHook(() => useViewport());
    expect(schmal.result.current.istSchmal).toBe(true);
    expect(schmal.result.current.abBreite('md')).toBe(false);
    expect(schmal.result.current.abBreite('lg')).toBe(false);

    setzeViewportBreite(1024);
    const breit = renderHook(() => useViewport());
    expect(breit.result.current.istSchmal).toBe(false);
    expect(breit.result.current.abBreite('md')).toBe(true);
    expect(breit.result.current.abBreite('lg')).toBe(true);
  });

  it("useViewport: bei 800 px greift abBreite('md'), abBreite('lg') aber nicht", () => {
    // Der Punkt, der die Pakete trennt: Navigationsrahmen und Kopfzeile schalten bei
    // < lg (992), die Verwaltungsseiten bei < md (768). Ohne diese beiden Achsen im
    // Hook baut sich jedes Paket seine eigene Ableitung.
    setzeViewportBreite(800);
    const { result } = renderHook(() => useViewport());

    expect(result.current.abBreite('md')).toBe(true);
    expect(result.current.abBreite('lg')).toBe(false);
    expect(result.current.istSchmal).toBe(false);
  });

  it('useViewport: die rohe Screens-Karte kommt unverändert mit', () => {
    setzeViewportBreite(1024);
    const { result } = renderHook(() => useViewport());

    expect(result.current.screens.md).toBe(true);
    expect(result.current.screens.lg).toBe(true);
    expect(result.current.screens.xl).toBe(false);
  });

  it('abBreiteAus: eine leere Screens-Map gilt als breit', () => {
    // `Grid.useBreakpoint()` liefert auf dem ERSTEN Render `{}` und korrigiert erst im
    // useLayoutEffect. Wäre „unbekannt" gleich „schmal", blitzte im Primärkontext Fükw
    // für einen Frame das Handy-Layout auf. Deshalb: unbekannt ⇒ breit.
    expect(abBreiteAus({}, 'md')).toBe(true);
    expect(abBreiteAus({}, 'lg')).toBe(true);

    expect(abBreiteAus({ md: false }, 'md')).toBe(false);
    expect(abBreiteAus({ md: true }, 'md')).toBe(true);
  });

  it("abBreite nimmt 'xs' gar nicht erst entgegen", () => {
    // `xs` ist als EINZIGER antd-Breakpoint eine max-width-Abfrage (responsiveObserver.js):
    // bei 1024 px wäre screens.xs falsch, und abBreite('xs') läse sich als „schmaler als
    // xs" — die Umkehrung dessen, was der Name verspricht. Der Typ verhindert den Aufruf.
    // Diese Zeile wird rot, sobald sie doch typecheckt.
    // @ts-expect-error 'xs' ist aus AbBreitePunkt ausgeschlossen
    expect(() => abBreiteAus({}, 'xs')).toBeTypeOf('function');
  });

  it('useViewport: fragt (pointer: coarse) und nicht (any-pointer: coarse)', () => {
    // Ohne diesen Pin wäre ein stiller Wechsel auf any-pointer folgenlos — und der
    // erzwänge am Fükw-Laptop mit Touchscreen dauerhaft Berührungs-Trefflächen.
    renderHook(() => useViewport());

    expect(erfassteQueries()).toContain('(pointer: coarse)');
    expect(erfassteQueries()).not.toContain('(any-pointer: coarse)');
  });

  it('useViewport: istBeruehrung folgt der Zeigerart beim Render', () => {
    const fein = renderHook(() => useViewport());
    expect(fein.result.current.istBeruehrung).toBe(false);

    setzeZeigerGrob(true);
    const grob = renderHook(() => useViewport());
    expect(grob.result.current.istBeruehrung).toBe(true);
  });

  it('useViewport: eine Zeigerart-Änderung schlägt durch und feuert nach unmount nicht mehr', () => {
    // Der einzige Beleg dafür, dass der Zuhörer-Effekt keine tote Zeile ist: der frühere
    // Stub speicherte Zuhörer gar nicht, jedes Ereignis verpuffte, und ein Effekt ohne
    // Beleg sähe grün aus.
    const { result, unmount } = renderHook(() => useViewport());
    expect(result.current.istBeruehrung).toBe(false);

    act(() => {
      expect(sendeZeigerAenderung(true)).toBe(1);
    });
    expect(result.current.istBeruehrung).toBe(true);

    unmount();
    expect(sendeZeigerAenderung(false)).toBe(0);
  });
});
