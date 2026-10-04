import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import { useSprungSperre } from './useSprungSperre';

/**
 * Sprung-Sperre aus dem Cache der Freigaben (LFH-888): zwei Aufrufer, EIN Abruf; die Sperre folgt
 * der Antwort, unbekannt heißt offen.
 */

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useSprungSperre (LFH-888)', () => {
  it('sperrt nach der Antwort des Servers, vorher nicht; zwei Aufrufer teilen einen Abruf', async () => {
    let abrufe = 0;
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () => {
        abrufe += 1;
        return HttpResponse.json(freigabenFixture({ etb: { zugriff: false } }));
      }),
    );
    const client = neuerQueryClient();
    const { result } = renderHook(() => [useSprungSperre(7), useSprungSperre(7)] as const, {
      wrapper: wrapper(client),
    });
    // Unbekannt: offen — kein Aufblitzen gesperrter Knöpfe.
    expect(result.current[0]('etb')).toBe(false);
    await waitFor(() => expect(result.current[0]('etb')).toBe(true));
    expect(result.current[1]('etb')).toBe(true);
    expect(result.current[0]('lageberichte')).toBe(false);
    expect(abrufe).toBe(1);
  });
});
