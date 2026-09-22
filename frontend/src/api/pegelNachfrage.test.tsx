import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { pegelAbfrage } from './pegel';

/**
 * Die einmalige Nachfrage bei fehlender Messung (Prüfliste O2) im echten TanStack-Kreislauf:
 * dass `refetchInterval` bei JEDER Auswertung dasselbe sagt, beweist die reine Funktion
 * (`pegel.test.ts`); dass TanStack daraus genau EINEN kurzen Abruf macht, nur dies hier.
 */

const mitMessung = {
  id: 1,
  station_uuid: 'a',
  name: 'A',
  reihenfolge: 0,
  messung: { wasserstand_cm: 684, zeitpunkt: '2026-09-22T14:05:00+02:00' },
};
const ohneMessung = { id: 1, station_uuid: 'a', name: 'A', reihenfolge: 0 };

function abrufe(antworten: unknown[][]) {
  let n = 0;
  server.use(
    http.get('/api/einsaetze/1/pegel', () => {
      const antwort = antworten[Math.min(n, antworten.length - 1)];
      n += 1;
      return HttpResponse.json(antwort);
    }),
  );
  return () => n;
}

function rendern() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useQuery(pegelAbfrage(1)), { wrapper });
}

async function vorlauf(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('pegelAbfrage — einmalige Nachfrage bei fehlender Messung', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fehlt die Messung, kommt nach ~10 s genau EIN Abruf; danach wieder der 5-min-Takt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const zahl = abrufe([[ohneMessung], [mitMessung]]);
    const { result } = rendern();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(zahl()).toBe(1);
    await vorlauf(9_000);
    expect(zahl()).toBe(1);
    await vorlauf(2_000);
    await waitFor(() => expect(result.current.data?.[0].messung).toBeDefined());
    expect(zahl()).toBe(2);
    await vorlauf(60_000);
    expect(zahl()).toBe(2);
  });

  it('fehlt sie auch danach, bleibt es bei der einen Nachfrage — keine Schleife', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const zahl = abrufe([[ohneMessung]]);
    const { result } = rendern();
    await waitFor(() => expect(result.current.data).toBeDefined());
    await vorlauf(11_000);
    await waitFor(() => expect(zahl()).toBe(2));
    await vorlauf(120_000);
    expect(zahl()).toBe(2);
  });

  it('ist die Messung da, gibt es keine Nachfrage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const zahl = abrufe([[mitMessung]]);
    const { result } = rendern();
    await waitFor(() => expect(result.current.data).toBeDefined());
    await vorlauf(60_000);
    expect(zahl()).toBe(1);
  });
});
