import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import type { NeuerEintrag } from '../api/etb';
import { queueLeerenFuerTests } from './queue';
import { useEtbErfassung } from './useEtbErfassung';

const eintrag: NeuerEintrag = { typ: 'meldung', inhalt: 'x', erfasst_lokal_at: '2026-05-23T10:00:00Z' };

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={neuerQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await queueLeerenFuerTests();
});

describe('useEtbErfassung', () => {
  it('reiht bei Netzwerkfehler ein und sendet beim Flush nach', async () => {
    let versuch = 0;
    server.use(
      http.post('/api/einsaetze/9/etb', () => {
        versuch += 1;
        return versuch === 1
          ? HttpResponse.error()
          : HttpResponse.json({ id: 1, lfd_nr: 1 }, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });

    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    await act(async () => {
      await result.current.flush();
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(0));
    expect(versuch).toBe(2);
  });

  it('reicht fachliche Ablehnung (ApiError) an den Aufrufer durch', async () => {
    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }),
      ),
    );
    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await expect(result.current.erfassen(eintrag)).rejects.toMatchObject({ status: 403 });
    expect(result.current.ausstehend).toHaveLength(0);
  });
});
