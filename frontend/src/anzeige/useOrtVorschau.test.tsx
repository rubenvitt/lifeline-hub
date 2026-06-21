import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { holeOrt, leereOrtCache, ortKeyVon, setzeOrt } from './ortCache';
import { useOrtVorschau } from './useOrtVorschau';

function wrapper(client = neuerQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => leereOrtCache());

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

  it('feuert nicht vor Ablauf des Debounce-Fensters, aber danach genau einmal', async () => {
    const treffer = vi.fn();
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () => {
        treffer();
        return HttpResponse.json({ peilung: null, ortsname: null });
      }),
    );
    const { result } = renderHook(
      () => useOrtVorschau(1, { lat: 51.5, lon: 10.25 }, undefined, 120),
      { wrapper: wrapper() },
    );
    // Unmittelbar nach dem Mount: noch kein Call (Debounce nicht initial umgangen).
    expect(treffer).not.toHaveBeenCalled();
    // Mitten im Debounce-Fenster (< 120 ms): immer noch kein Call.
    await new Promise((r) => setTimeout(r, 50));
    expect(treffer).not.toHaveBeenCalled();
    // Nach Ablauf des Fensters: genau ein Call, Daten da.
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(treffer).toHaveBeenCalledTimes(1);
  });

  it('persistiert den Ortsnamen im Local-Store bei Erfolg', async () => {
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: 'Hauptstr. 5, Musterstadt' }),
      ),
    );
    const { result } = renderHook(
      () => useOrtVorschau(1, { lat: 51.5, lon: 10.25 }, undefined, 0),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.data?.ortsname).toBe('Hauptstr. 5, Musterstadt'));
    await waitFor(async () =>
      expect(await holeOrt(ortKeyVon(51.5, 10.25))).toBe('Hauptstr. 5, Musterstadt'),
    );
  });

  it('fällt auf den persistierten Ortsnamen zurück, wenn die Live-Antwort ortsname=null hat', async () => {
    await setzeOrt(ortKeyVon(48.1, 11.6), 'Aus Local-Store');
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () =>
        HttpResponse.json({ peilung: { distanz_m: 100, richtung: 'N', bezug_label: 'X' }, ortsname: null }),
      ),
    );
    const { result } = renderHook(
      () => useOrtVorschau(1, { lat: 48.1, lon: 11.6 }, undefined, 0),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.data?.ortsname).toBe('Aus Local-Store'));
    expect(result.current.data?.peilung?.richtung).toBe('N');
  });
});
