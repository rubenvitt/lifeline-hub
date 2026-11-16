import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { OFFLINE_QUEUE_EVENT, type OfflineQueueZaehler } from './queue';
import { QUEUE_ZAEHLER_MERKER } from './queueZaehlerMerker';
import { useOfflineQueueZaehler, ZAEHLER_DROSSEL_MS } from './useOfflineQueueZaehler';

const geladen = vi.hoisted(() => ({
  anzahl: 0,
  /** Gesetzt, antwortet die Queue damit statt mit dem Zähler der Aufrufe. */
  antwort: null as null | (() => Promise<OfflineQueueZaehler>),
}));
vi.mock('./queue', async (original) => {
  const echt = await original<typeof import('./queue')>();
  return {
    ...echt,
    queueZaehlerLaden: async () => {
      geladen.anzahl += 1;
      if (geladen.antwort) return geladen.antwort();
      return { ausstehend: geladen.anzahl, abgelehnt: 0, nicht_zugeordnet: 0 };
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  geladen.anzahl = 0;
  geladen.antwort = null;
});

describe('useOfflineQueueZaehler (LFH-939, design.md D5)', () => {
  it('lädt bei einer Flut von Queue-Ereignissen höchstens einmal je Drosselfenster', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOfflineQueueZaehler(11));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ZAEHLER_DROSSEL_MS * 2);
    });
    expect(geladen.anzahl).toBe(1);

    // Ein Abgleich von 50 Zeilen in kurzer Folge.
    await act(async () => {
      for (let i = 0; i < 50; i++) {
        window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
        await vi.advanceTimersByTimeAsync(2);
      }
      await vi.advanceTimersByTimeAsync(ZAEHLER_DROSSEL_MS * 2);
    });
    expect(geladen.anzahl).toBeLessThanOrEqual(3);
    // Der letzte Stand kommt trotzdem an: nach dem letzten Ereignis lief ein Ladevorgang.
    expect(result.current.ausstehend).toBe(geladen.anzahl);
    expect(geladen.anzahl).toBeGreaterThan(1);
  });
});

/** Die Queue antwortet nie: alles, was der Hook zeigt, stammt aus dem Merker. */
const nieAntworten = () => new Promise<OfflineQueueZaehler>(() => {});

function merke(wert: unknown) {
  localStorage.setItem(
    QUEUE_ZAEHLER_MERKER,
    typeof wert === 'string' ? wert : JSON.stringify(wert),
  );
}

function gemerkt(): unknown {
  const roh = localStorage.getItem(QUEUE_ZAEHLER_MERKER);
  return roh === null ? null : JSON.parse(roh);
}

describe('useOfflineQueueZaehler: der Stand vor dem ersten Bild (LLH-1910, Spec `kopfleiste`)', () => {
  it('startet mit dem gemerkten Stand derselben Person, bevor die Queue antwortet', () => {
    geladen.antwort = nieAntworten;
    merke({ benutzer_id: 11, ausstehend: 2, abgelehnt: 1, nicht_zugeordnet: 0 });
    const { result } = renderHook(() => useOfflineQueueZaehler(11));
    expect(result.current).toEqual({ ausstehend: 2, abgelehnt: 1, nicht_zugeordnet: 0 });
  });

  it('nimmt keinen Stand einer anderen Person', () => {
    geladen.antwort = nieAntworten;
    merke({ benutzer_id: 12, ausstehend: 2, abgelehnt: 0, nicht_zugeordnet: 0 });
    const { result } = renderHook(() => useOfflineQueueZaehler(11));
    expect(result.current).toEqual({ ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0 });
  });

  it.each([
    ['kein JSON', '{'],
    ['keine Zahl', { benutzer_id: 11, ausstehend: '2', abgelehnt: 0, nicht_zugeordnet: 0 }],
    ['negativ', { benutzer_id: 11, ausstehend: -1, abgelehnt: 0, nicht_zugeordnet: 0 }],
    ['ohne Feld', { benutzer_id: 11, ausstehend: 2 }],
    ['null', null],
  ])('liest einen kaputten Merker (%s) als leer', (_, wert) => {
    geladen.antwort = nieAntworten;
    merke(wert);
    const { result } = renderHook(() => useOfflineQueueZaehler(11));
    expect(result.current).toEqual({ ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0 });
  });

  it('nimmt den Merker auch, wenn die Person erst nach dem ersten Render feststeht', () => {
    geladen.antwort = nieAntworten;
    merke({ benutzer_id: 11, ausstehend: 2, abgelehnt: 0, nicht_zugeordnet: 0 });
    const { result, rerender } = renderHook(({ id }) => useOfflineQueueZaehler(id), {
      initialProps: { id: undefined as number | undefined },
    });
    expect(result.current.ausstehend).toBe(0);
    rerender({ id: 11 });
    expect(result.current.ausstehend).toBe(2);
  });

  it('merkt nach dem Laden den gelesenen Stand, auch einen leeren', async () => {
    merke({ benutzer_id: 11, ausstehend: 2, abgelehnt: 0, nicht_zugeordnet: 0 });
    geladen.antwort = async () => ({ ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0 });
    const { result } = renderHook(() => useOfflineQueueZaehler(11));
    await vi.waitFor(() => expect(result.current.ausstehend).toBe(0));
    expect(gemerkt()).toEqual({
      benutzer_id: 11,
      ausstehend: 0,
      abgelehnt: 0,
      nicht_zugeordnet: 0,
    });
  });

  it('merkt nach einem Benutzerwechsel den Stand der neuen Person', async () => {
    merke({ benutzer_id: 12, ausstehend: 4, abgelehnt: 0, nicht_zugeordnet: 0 });
    geladen.antwort = async () => ({ ausstehend: 1, abgelehnt: 0, nicht_zugeordnet: 0 });
    const { result } = renderHook(() => useOfflineQueueZaehler(11));
    await vi.waitFor(() => expect(result.current.ausstehend).toBe(1));
    expect(gemerkt()).toEqual({
      benutzer_id: 11,
      ausstehend: 1,
      abgelehnt: 0,
      nicht_zugeordnet: 0,
    });
  });

  it('liest und schreibt im Scope eines Einsatzes keinen Merker', async () => {
    const vorher = { benutzer_id: 11, ausstehend: 2, abgelehnt: 0, nicht_zugeordnet: 0 };
    merke(vorher);
    let antworten: (wert: OfflineQueueZaehler) => void = () => {};
    geladen.antwort = () => new Promise((fertig) => (antworten = fertig));
    const { result } = renderHook(() => useOfflineQueueZaehler(11, 5));
    expect(result.current.ausstehend).toBe(0);
    await act(async () => antworten({ ausstehend: 7, abgelehnt: 0, nicht_zugeordnet: 0 }));
    expect(result.current.ausstehend).toBe(7);
    expect(gemerkt()).toEqual(vorher);
  });
});
