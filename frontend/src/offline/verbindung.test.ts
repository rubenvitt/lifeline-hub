import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetzFehler } from '../api/client';
import { erzeugeQueryClient } from '../api/queryClient';
import {
  istVerbindungsfehler,
  meldeServerErreichbar,
  useOhneVerbindung,
  verbindungZuruecksetzenFuerTests,
} from './verbindung';

afterEach(() => verbindungZuruecksetzenFuerTests());

describe('Verbindung (LFH-723, design.md D7)', () => {
  it('ordnet nur Leitungsfehler als Verbindungsfehler ein', () => {
    expect(istVerbindungsfehler(new NetzFehler())).toBe(true);
    // Ohne den `{error}`-Umschlag des eigenen Servers: die Fehlerseite eines Gateways.
    expect(istVerbindungsfehler(new ApiError(503, 'x'))).toBe(true);
    expect(istVerbindungsfehler(new ApiError(502, 'x'))).toBe(true);
    expect(istVerbindungsfehler(new ApiError(504, 'x'))).toBe(true);
    // MIT Umschlag hat der eigene Server geantwortet (Lastabwurf 503, Pegel-Upstream 502):
    // er ist erreichbar, also nicht „offline" (Review LFH-723, Befund 4).
    expect(istVerbindungsfehler(new ApiError(503, 'x', { vomAnwendungsserver: true }))).toBe(false);
    expect(istVerbindungsfehler(new ApiError(502, 'x', { vomAnwendungsserver: true }))).toBe(false);
    expect(istVerbindungsfehler(new ApiError(500, 'x'))).toBe(false);
    expect(istVerbindungsfehler(new ApiError(403, 'x'))).toBe(false);
    expect(istVerbindungsfehler(new Error('x'))).toBe(false);
  });

  it('ist ohne Verbindung, wenn der Browser offline ist ODER der Server nicht erreichbar', () => {
    const { result } = renderHook(() => useOhneVerbindung());
    expect(result.current).toBe(false);
    act(() => meldeServerErreichbar(false));
    expect(result.current).toBe(true);
    act(() => meldeServerErreichbar(true));
    expect(result.current).toBe(false);
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(true);
    onLine.mockRestore();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(false);
  });

  it('der QueryClient meldet einen gescheiterten Abruf schon beim ersten Fehlversuch', async () => {
    const client = erzeugeQueryClient();
    const { result } = renderHook(() => useOhneVerbindung());
    const abruf = client
      .fetchQuery({ queryKey: ['x', 1], queryFn: () => Promise.reject(new NetzFehler()) })
      .catch(() => {});
    // Die Produktionsvorgabe wiederholt zweimal mit Backoff — die Kennzeichnung wartet nicht
    // darauf, sondern kommt mit dem ersten gescheiterten Versuch. Die 900 ms sind die Aussage, kein
    // Wartebudget: die erste Wiederholung käme nach 1 s (`retryDelay`, `api/queryClient.ts`).
    await waitFor(() => expect(result.current).toBe(true), { timeout: 900 });
    await abruf;
  });

  it('ein Fetch-Erfolg hebt die Meldung wieder auf, eine fachliche Ablehnung nicht', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    const { result } = renderHook(() => useOhneVerbindung());
    act(() => meldeServerErreichbar(false));
    await act(() =>
      client
        .fetchQuery({ queryKey: ['y', 1], queryFn: () => Promise.reject(new ApiError(403, 'x')) })
        .catch(() => {}),
    );
    expect(result.current).toBe(true);
    await act(() => client.fetchQuery({ queryKey: ['z', 1], queryFn: async () => 1 }));
    expect(result.current).toBe(false);
  });

  it('meldet auch eine Mutation, die an der Leitung scheitert', async () => {
    const client = erzeugeQueryClient({ mutations: { retry: false } });
    const { result } = renderHook(() => useOhneVerbindung());
    await act(() =>
      client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(new NetzFehler()) })
        .execute(undefined)
        .catch(() => {}),
    );
    expect(result.current).toBe(true);
  });
});
