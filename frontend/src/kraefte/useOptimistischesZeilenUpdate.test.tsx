import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { useOptimistischesZeilenUpdate } from './useOptimistischesZeilenUpdate';

/**
 * Optimistische Zeilenänderung (LFH-1077): Beginn und Ablehnung kommen MIT der Zeile beim
 * Aufrufer an, damit er den Grund an genau diese Zeile schreibt (`components/useZeilenFehler.ts`).
 * Ohne `onFehler` nimmt der Hook nur zurück.
 */

interface Zeile {
  id: number;
  wert: string;
}

const KEY = ['zeilen'];

function aufbau(
  mutationFn: (v: { id: number; wert: string }) => Promise<Zeile>,
  rueckrufe: {
    onBeginn?: (v: { id: number; wert: string }) => void;
    onFehler?: (e: unknown, v: { id: number; wert: string }) => void;
  },
) {
  // Ohne `gcTime: 0` der Testfabrik: die Liste hat hier keinen Beobachter und fiele sonst weg.
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData<Zeile[]>(KEY, [
    { id: 1, wert: 'a' },
    { id: 2, wert: 'b' },
  ]);
  const huelle = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useOptimistischesZeilenUpdate<Zeile, { id: number; wert: string }>({
        queryKey: KEY,
        mutationFn,
        zeilenId: (v) => v.id,
        anwenden: (z, v) => ({ ...z, wert: v.wert }),
        nochOptimistisch: (z, v) => z.wert === v.wert,
        zuruecknehmen: (z, vorher) => ({ ...z, wert: vorher.wert }),
        onSettled: () => {},
        ...rueckrufe,
      }),
    { wrapper: huelle },
  );
  return { client, result };
}

describe('useOptimistischesZeilenUpdate (LFH-1077)', () => {
  it('meldet Beginn und Ablehnung mit den Variablen der Zeile und nimmt zurück', async () => {
    const onBeginn = vi.fn();
    const onFehler = vi.fn();
    const abgelehnt = new ApiError(409, 'Status abgelehnt');
    const { client, result } = aufbau(() => Promise.reject(abgelehnt), { onBeginn, onFehler });

    act(() => result.current.mutate({ id: 2, wert: 'neu' }));

    await waitFor(() => expect(onFehler).toHaveBeenCalledTimes(1));
    expect(onBeginn).toHaveBeenCalledWith({ id: 2, wert: 'neu' });
    expect(onFehler).toHaveBeenCalledWith(abgelehnt, { id: 2, wert: 'neu' });
    expect(client.getQueryData<Zeile[]>(KEY)?.[1].wert).toBe('b');
  });

  it('ohne `onFehler` nimmt er nur zurück', async () => {
    const { client, result } = aufbau(() => Promise.reject(new Error('weg')), {});

    act(() => result.current.mutate({ id: 1, wert: 'neu' }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<Zeile[]>(KEY)?.[0].wert).toBe('a');
  });
});
