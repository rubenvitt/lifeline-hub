import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useOrtVorschau } from './useOrtVorschau';

function wrapper(client = neuerQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useOrtVorschau', () => {
  it('ruft nach Debounce und liefert die Antwort', async () => {
    const treffer = vi.fn();
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () => {
        treffer();
        return HttpResponse.json({
          peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
          ortsname: null,
        });
      }),
    );
    const { result } = renderHook(
      () => useOrtVorschau(1, { lat: 51.5, lon: 10.25 }, undefined, 20),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(treffer).toHaveBeenCalledTimes(1);
    expect(result.current.data?.peilung?.richtung).toBe('NO');
  });

  it('feuert keinen Call bei ungültiger (null) Koordinate', async () => {
    const treffer = vi.fn();
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () => {
        treffer();
        return HttpResponse.json({ peilung: null, ortsname: null });
      }),
    );
    renderHook(() => useOrtVorschau(1, null, undefined, 20), { wrapper: wrapper() });
    // Genug Zeit für einen etwaigen Debounce verstreichen lassen.
    await new Promise((r) => setTimeout(r, 60));
    expect(treffer).not.toHaveBeenCalled();
  });

  it('feuert nicht vor Ablauf des Debounce-Fensters', () => {
    const treffer = vi.fn();
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () => {
        treffer();
        return HttpResponse.json({ peilung: null, ortsname: null });
      }),
    );
    // Großzügiges Fenster; unmittelbar nach dem Render darf noch nichts gefeuert haben.
    renderHook(() => useOrtVorschau(1, { lat: 51.5, lon: 10.25 }, undefined, 500), {
      wrapper: wrapper(),
    });
    expect(treffer).not.toHaveBeenCalled();
  });
});
