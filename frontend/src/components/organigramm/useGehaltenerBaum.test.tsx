import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { FocusEvent, PointerEvent } from 'react';
import { useGehaltenerBaum } from './useGehaltenerBaum';

interface K {
  key: string;
  kinder: readonly K[];
}
const k = (key: string, ...kinder: K[]): K => ({ key, kinder });

const zeiger = (pointerType: string) => ({ pointerType }) as unknown as PointerEvent;
const raus = (relatedTarget: EventTarget | null) => ({ relatedTarget }) as unknown as FocusEvent;

/** Struktur als Schlüsselpfade, damit der Vergleich die gezeigte Ordnung prüft. */
const form = (ks: readonly K[]): unknown => ks.map((x) => [x.key, form(x.kinder)]);

const vorher = [k('nord', k('ost')), k('sued')];
// „ost“ hängt woanders: unter „sued“.
const nachher = [k('nord'), k('sued', k('ost'))];

describe('useGehaltenerBaum (LFH-1212)', () => {
  it('lässt ohne Haltebedingung den frischen Stand durch', () => {
    const { result, rerender } = renderHook(({ w }) => useGehaltenerBaum(w), {
      initialProps: { w: vorher },
    });
    rerender({ w: nachher });
    expect(form(result.current.stand.gezeigt)).toEqual(form(nachher));
    expect(result.current.offen).toBe(true);
  });

  it('hält die Struktur, solange ein Mauszeiger im Bereich ist, und zählt das Umgehängte', () => {
    const { result, rerender } = renderHook(({ w }) => useGehaltenerBaum(w), {
      initialProps: { w: vorher },
    });
    act(() => result.current.bereich.onPointerEnter(zeiger('mouse')));
    rerender({ w: nachher });
    expect(form(result.current.stand.gezeigt)).toEqual(form(vorher));
    expect(result.current.stand.wartend.umgehaengt).toBe(1);
    expect(result.current.offen).toBe(false);

    act(() => result.current.bereich.onPointerLeave(zeiger('mouse')));
    expect(form(result.current.stand.gezeigt)).toEqual(form(nachher));
  });

  it('Touch hält nicht', () => {
    const { result, rerender } = renderHook(({ w }) => useGehaltenerBaum(w), {
      initialProps: { w: vorher },
    });
    act(() => result.current.bereich.onPointerEnter(zeiger('touch')));
    act(() => result.current.bereich.onPointerMove(zeiger('touch')));
    rerender({ w: nachher });
    expect(form(result.current.stand.gezeigt)).toEqual(form(nachher));
  });

  it('der Fokus hält, bis er den Bereich verlässt', () => {
    const { result, rerender } = renderHook(({ w }) => useGehaltenerBaum(w), {
      initialProps: { w: vorher },
    });
    act(() => result.current.bereich.onFocus());
    rerender({ w: nachher });
    expect(form(result.current.stand.gezeigt)).toEqual(form(vorher));
    act(() => result.current.bereich.onBlur(raus(null)));
    expect(form(result.current.stand.gezeigt)).toEqual(form(nachher));
  });

  it('ein Zug hält, auch ohne Zeiger im Bereich', () => {
    const { result, rerender } = renderHook(({ w }) => useGehaltenerBaum(w), {
      initialProps: { w: vorher },
    });
    act(() => result.current.holdDrag(true));
    rerender({ w: nachher });
    expect(form(result.current.stand.gezeigt)).toEqual(form(vorher));
    act(() => result.current.holdDrag(false));
    expect(form(result.current.stand.gezeigt)).toEqual(form(nachher));
  });

  it('eine eigene Handlung zeigt ihr Ergebnis sofort und hält ab dort weiter', () => {
    const { result, rerender } = renderHook(({ w }) => useGehaltenerBaum(w), {
      initialProps: { w: vorher },
    });
    act(() => result.current.bereich.onPointerEnter(zeiger('mouse')));
    // Der Zug selbst: das Ergebnis steht, bevor der Zwischenspeicher nachzieht.
    act(() => result.current.uebernehmen(nachher));
    expect(form(result.current.stand.gezeigt)).toEqual(form(nachher));
    rerender({ w: nachher });
    expect(result.current.stand.wartend.umgehaengt).toBe(0);
    // Ein fremder Zug danach wartet wieder.
    rerender({ w: vorher });
    expect(form(result.current.stand.gezeigt)).toEqual(form(nachher));
    expect(result.current.stand.wartend.umgehaengt).toBe(1);
  });

  it('ein leerer Baum schließt nicht: die erste Lieferung landet nicht hinter dem Banner', () => {
    const { result, rerender } = renderHook(({ w }) => useGehaltenerBaum(w), {
      initialProps: { w: [] as K[] },
    });
    act(() => result.current.bereich.onPointerEnter(zeiger('mouse')));
    rerender({ w: vorher });
    expect(form(result.current.stand.gezeigt)).toEqual(form(vorher));
  });
});
