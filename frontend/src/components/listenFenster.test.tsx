import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useInfiniteQuery,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LISTEN_MAX_SEITEN, kopfVerlassen, useKopfBeimVerlassen, zumKopf } from './listenFenster';

/**
 * Seitenfenster der Listen ohne Cursor nach vorn (LLH-1687): ein Live-Ereignis nach tiefem
 * Blättern lädt höchstens das Fenster neu, und der Kopf ist über `zumKopf` wieder erreichbar.
 */

const SCHLUESSEL = ['liste'];

/** Seite `n` hält die Nummer `n`; Seite 0 ist der Kopf (Parameter `undefined`). */
function aufbau() {
  const abruf = vi.fn(async (param: number | undefined) => [param ?? 0]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useInfiniteQuery({
        queryKey: SCHLUESSEL,
        queryFn: ({ pageParam }) => abruf(pageParam),
        initialPageParam: undefined as number | undefined,
        getNextPageParam: (letzte) => letzte[0] + 1,
        maxPages: LISTEN_MAX_SEITEN,
      }),
    { wrapper },
  );
  return { abruf, client, result };
}

function letzterParam(result: ReturnType<typeof aufbau>['result']) {
  const params = result.current.data?.pageParams ?? [];
  return params[params.length - 1];
}

async function blaettere(result: ReturnType<typeof aufbau>['result'], seiten: number) {
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  for (let i = 0; i < seiten; i++) {
    const vorher = letzterParam(result);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(letzterParam(result)).not.toBe(vorher));
  }
}

describe('listenFenster (LLH-1687)', () => {
  it('hält höchstens LISTEN_MAX_SEITEN Seiten; der Kopf fällt erst danach heraus', async () => {
    const { result } = aufbau();
    await blaettere(result, LISTEN_MAX_SEITEN - 1);
    expect(result.current.data?.pages).toHaveLength(LISTEN_MAX_SEITEN);
    expect(kopfVerlassen(result.current.data)).toBe(false);

    await blaettere(result, 1);
    expect(result.current.data?.pages).toHaveLength(LISTEN_MAX_SEITEN);
    expect(result.current.data?.pages[0]).toEqual([1]);
    expect(kopfVerlassen(result.current.data)).toBe(true);
  });

  it('lädt bei einer Invalidierung nach tiefem Blättern nur das Fenster neu', async () => {
    const { abruf, client, result } = aufbau();
    await blaettere(result, 20);
    abruf.mockClear();

    await act(() => client.invalidateQueries({ queryKey: SCHLUESSEL }));
    expect(abruf).toHaveBeenCalledTimes(LISTEN_MAX_SEITEN);
  });

  it('zumKopf ersetzt das Fenster durch die neueste Seite', async () => {
    const { client, result } = aufbau();
    await blaettere(result, 8);
    expect(kopfVerlassen(result.current.data)).toBe(true);

    let ersetzt = false;
    await act(async () => {
      ersetzt = await zumKopf(client, SCHLUESSEL, async () => [0]);
    });
    expect(ersetzt).toBe(true);
    await waitFor(() => expect(result.current.data?.pages).toEqual([[0]]));
    expect(kopfVerlassen(result.current.data)).toBe(false);
  });

  it('zumKopf lässt das Fenster stehen, wenn der Abruf scheitert', async () => {
    const { client, result } = aufbau();
    await blaettere(result, 8);
    const vorher = result.current.data;

    let ersetzt = true;
    await act(async () => {
      ersetzt = await zumKopf(client, SCHLUESSEL, () => Promise.reject(new Error('offline')));
    });
    expect(ersetzt).toBe(false);
    expect(result.current.data).toBe(vorher);
  });

  it('kopfVerlassen ist ohne Daten falsch', () => {
    expect(kopfVerlassen(undefined)).toBe(false);
    expect(kopfVerlassen({ pages: [], pageParams: [] })).toBe(false);
  });

  it('zumKopf holt noch einmal, wenn während des Abrufs ein Ereignis kam', async () => {
    const { abruf, client, result } = aufbau();
    await blaettere(result, 8);
    abruf.mockClear();
    await act(async () => {
      await zumKopf(client, SCHLUESSEL, async () => {
        // Das Live-Ereignis kommt, während der Kopf unterwegs ist.
        void client.invalidateQueries({ queryKey: SCHLUESSEL });
        return [0];
      });
    });
    await waitFor(() => expect(abruf).toHaveBeenCalledWith(undefined));
    expect(client.getQueryState(SCHLUESSEL)?.isInvalidated).toBe(false);
  });

  it('zumKopf holt noch einmal, wenn das Neuladen des Ereignisses schon fertig war', async () => {
    const { abruf, client, result } = aufbau();
    await blaettere(result, 8);
    abruf.mockClear();
    await act(async () => {
      await zumKopf(client, SCHLUESSEL, async () => {
        // Ereignis und Neuladen des Fensters laufen ganz durch, bevor der Kopf zurückkommt.
        await client.invalidateQueries({ queryKey: SCHLUESSEL });
        return [0];
      });
    });
    await waitFor(() => expect(abruf).toHaveBeenCalledWith(undefined));
  });

  it('useKopfBeimVerlassen verwirft beim Verlassen ein Fenster ohne Kopf, eines mit Kopf nicht', async () => {
    const { client, result } = aufbau();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    await blaettere(result, 2);
    const mitKopf = renderHook(
      () => {
        const [aktiv, setAktiv] = useState(true);
        useKopfBeimVerlassen(SCHLUESSEL, aktiv);
        return setAktiv;
      },
      { wrapper },
    );
    act(() => mitKopf.result.current(false));
    expect(client.getQueryData(SCHLUESSEL)).toBeDefined();

    await blaettere(result, 6);
    expect(kopfVerlassen(client.getQueryData(SCHLUESSEL))).toBe(true);
    const ohneKopf = renderHook(() => useKopfBeimVerlassen(SCHLUESSEL, true), { wrapper });
    ohneKopf.unmount();
    expect(client.getQueryCache().find({ queryKey: SCHLUESSEL, exact: true })).toBeUndefined();
  });

  it('useKopfBeimVerlassen verwirft ohne Netz nichts', async () => {
    const { client, result } = aufbau();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    await blaettere(result, 6);
    onlineManager.setOnline(false);
    try {
      const ohneKopf = renderHook(() => useKopfBeimVerlassen(SCHLUESSEL, true), { wrapper });
      ohneKopf.unmount();
      expect(kopfVerlassen(client.getQueryData(SCHLUESSEL))).toBe(true);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
