import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { neuerQueryClient } from '../test/utils';
import { globalKeys } from '../api/queryKeys';
import { server } from '../test/server';
import type { BenutzerEinstellungen } from '../api/types';
import { useEinstellungMerken } from './useEinstellungMerken';

const auth = vi.hoisted(() => ({
  wert: { benutzer: { id: 1 }, geraet: null } as { benutzer: unknown; geraet: unknown } | null,
}));
vi.mock('../auth/AuthContext', () => ({ useAuthOptional: () => auth.wert }));

function aufbau(status = 200) {
  const geschrieben: string[] = [];
  server.use(
    http.get('/api/user-settings', () =>
      HttpResponse.json({ eintraege: { zuletzt_befehle: '[]' } }),
    ),
    http.put('/api/user-settings/:schluessel', ({ params }) => {
      geschrieben.push(String(params.schluessel));
      return status === 200
        ? HttpResponse.json({ eintraege: {} })
        : HttpResponse.json({ fehler: 'kaputt' }, { status });
    }),
  );
  const client = neuerQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useEinstellungMerken(), { wrapper });
  return { client, hook, geschrieben };
}

describe('useEinstellungMerken (LLH-1990)', () => {
  it('ergänzt nur den eigenen Schlüssel im Cache und schreibt ihn', async () => {
    const { client, hook, geschrieben } = aufbau();
    await waitFor(() => expect(hook.result.current.stand).toBeDefined());
    act(() => hook.result.current.merke('rundgang_liste_gesehen'));
    const cache = client.getQueryData<BenutzerEinstellungen>(
      globalKeys.benutzerEinstellungenVon(1),
    );
    expect(Object.keys(cache!.eintraege).sort()).toEqual([
      'rundgang_liste_gesehen',
      'zuletzt_befehle',
    ]);
    await waitFor(() => expect(geschrieben).toEqual(['rundgang_liste_gesehen']));
  });

  it('ein Fehler beim Schreiben lässt den Cache-Eintrag stehen', async () => {
    const { client, hook, geschrieben } = aufbau(500);
    await waitFor(() => expect(hook.result.current.stand).toBeDefined());
    act(() => hook.result.current.merke('rundgang_einsatz_gesehen'));
    await waitFor(() => expect(geschrieben).toHaveLength(1));
    const cache = client.getQueryData<BenutzerEinstellungen>(
      globalKeys.benutzerEinstellungenVon(1),
    );
    expect(cache!.eintraege).toHaveProperty('rundgang_einsatz_gesehen');
  });

  it('ein Gerätekonto hat keinen Stand', () => {
    auth.wert = { benutzer: { id: 1 }, geraet: { id: 9 } };
    const { hook } = aufbau();
    expect(hook.result.current.benutzerId).toBeNull();
    expect(hook.result.current.stand).toBeUndefined();
    auth.wert = { benutzer: { id: 1 }, geraet: null };
  });
});
