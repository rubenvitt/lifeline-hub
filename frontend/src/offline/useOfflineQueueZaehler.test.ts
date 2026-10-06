import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { OFFLINE_QUEUE_EVENT } from './queue';
import { useOfflineQueueZaehler, ZAEHLER_DROSSEL_MS } from './useOfflineQueueZaehler';

const geladen = vi.hoisted(() => ({ anzahl: 0 }));
vi.mock('./queue', async (original) => {
  const echt = await original<typeof import('./queue')>();
  return {
    ...echt,
    queueZaehlerLaden: async () => {
      geladen.anzahl += 1;
      return { ausstehend: geladen.anzahl, abgelehnt: 0, nicht_zugeordnet: 0 };
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  geladen.anzahl = 0;
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
