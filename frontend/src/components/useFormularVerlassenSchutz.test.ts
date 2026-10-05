import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFormularVerlassenSchutz } from './useFormularVerlassenSchutz';

function schliessen(): BeforeUnloadEvent {
  const ereignis = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(ereignis);
  return ereignis;
}

describe('useFormularVerlassenSchutz (LFH-979)', () => {
  it('ist ohne Änderung nicht ungespeichert und lässt den Tab ohne Warnung schließen', () => {
    const { result } = renderHook(() => useFormularVerlassenSchutz({ aktiv: true }));
    expect(result.current.ungespeichert).toBe(false);
    expect(schliessen().defaultPrevented).toBe(false);
  });

  it('merkt eine Änderung, warnt beim Schließen und fällt nach dem Speichern zurück', () => {
    const { result } = renderHook(() => useFormularVerlassenSchutz({ aktiv: true }));
    act(() => result.current.geaendert());
    expect(result.current.ungespeichert).toBe(true);
    expect(schliessen().defaultPrevented).toBe(true);

    const fassung = result.current.fassung();
    act(() => result.current.gespeichert(fassung));
    expect(result.current.ungespeichert).toBe(false);
    expect(schliessen().defaultPrevented).toBe(false);
  });

  it('hält den Schutz, wenn während des Speicherns weitergetippt wurde', () => {
    const { result } = renderHook(() => useFormularVerlassenSchutz({ aktiv: true }));
    act(() => result.current.geaendert());
    const fassung = result.current.fassung();
    // Eingabe, während der PATCH läuft — sie ist nicht gespeichert.
    act(() => result.current.geaendert());
    act(() => result.current.gespeichert(fassung));
    expect(result.current.ungespeichert).toBe(true);

    // Das nächste Speichern deckt sie ab.
    const zweite = result.current.fassung();
    act(() => result.current.gespeichert(zweite));
    expect(result.current.ungespeichert).toBe(false);
  });

  it('bleibt ohne Speichern (gescheitert) ungespeichert', () => {
    const { result } = renderHook(() => useFormularVerlassenSchutz({ aktiv: true }));
    act(() => result.current.geaendert());
    result.current.fassung();
    expect(result.current.ungespeichert).toBe(true);
  });

  it('schaltet ohne Schreibrecht Merker und Warnung ab', () => {
    const { result, rerender } = renderHook(({ aktiv }) => useFormularVerlassenSchutz({ aktiv }), {
      initialProps: { aktiv: false },
    });
    act(() => result.current.geaendert());
    expect(result.current.ungespeichert).toBe(false);
    expect(schliessen().defaultPrevented).toBe(false);

    // Kommt das Recht später (Rolle geladen), zählt nur, was ab dann geändert wird.
    rerender({ aktiv: true });
    expect(result.current.ungespeichert).toBe(false);
  });

  it('vergisst die Änderung beim Wechsel auf einen anderen Datensatz', () => {
    const { result, rerender } = renderHook(
      ({ id }) => useFormularVerlassenSchutz({ aktiv: true, schluessel: id }),
      { initialProps: { id: 1 } },
    );
    act(() => result.current.geaendert());
    expect(result.current.ungespeichert).toBe(true);
    rerender({ id: 2 });
    expect(result.current.ungespeichert).toBe(false);
    act(() => result.current.geaendert());
    expect(result.current.ungespeichert).toBe(true);
  });

  it('räumt den beforeunload-Hörer beim Abbau weg', () => {
    const entfernen = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useFormularVerlassenSchutz({ aktiv: true }));
    act(() => result.current.geaendert());
    unmount();
    expect(entfernen).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(schliessen().defaultPrevented).toBe(false);
    entfernen.mockRestore();
  });
});
