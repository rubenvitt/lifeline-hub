import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useFunkrufnamen } from './funkrufnamen';

function wrapper(client = neuerQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useFunkrufnamen', () => {
  it('sammelt Funkrufnamen aus Fahrzeugen (mit OPTA) und Einheiten', async () => {
    server.use(
      http.get('/api/einsaetze/1/fahrzeuge', () =>
        HttpResponse.json([
          { id: 1, funkrufname: 'Florian Musterstadt 1', opta: 'FL MUST 1' },
          { id: 2, funkrufname: 'RTW 1', opta: null },
        ]),
      ),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([{ id: 9, name: 'Zug 1' }])),
    );
    const { result } = renderHook(() => useFunkrufnamen(1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current).toContain('Florian Musterstadt 1 (FL MUST 1)');
    expect(result.current).toContain('RTW 1');
    expect(result.current).toContain('Zug 1');
  });

  it('dedupliziert und sortiert alphabetisch (de)', async () => {
    server.use(
      http.get('/api/einsaetze/1/fahrzeuge', () =>
        HttpResponse.json([
          { id: 1, funkrufname: 'Zebra', opta: null },
          { id: 2, funkrufname: 'Anton', opta: null },
        ]),
      ),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([{ id: 9, name: 'Anton' }])),
    );
    const { result } = renderHook(() => useFunkrufnamen(1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current).toEqual(['Anton', 'Zebra']);
  });
});
