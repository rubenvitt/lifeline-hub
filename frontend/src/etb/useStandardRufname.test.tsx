import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { globalKeys } from '../api/queryKeys';
import { benutzerFixture } from '../test/fixtures';
import type { BenutzerEinstellungen } from '../api/types';
import { SCHLUESSEL_ETB_STANDARD_RUFNAME } from './standardRufname';
import { useStandardRufname } from './useStandardRufname';

const nutzer = benutzerFixture({ anzeigename: 'EL', org_rolle: 'fuehrungskraft' });

let puts: { schluessel: string; wert: string }[];

beforeEach(() => {
  puts = [];
});

function handler(serverStand: BenutzerEinstellungen, putStatus = 200) {
  return [
    meHandler(nutzer),
    http.get('/api/benutzer-einstellungen', () => HttpResponse.json(serverStand)),
    http.put('/api/benutzer-einstellungen/:schluessel', async ({ params, request }) => {
      const body = (await request.json()) as { wert: string };
      puts.push({ schluessel: String(params.schluessel), wert: body.wert });
      if (putStatus !== 200) return HttpResponse.json({ error: 'nein' }, { status: putStatus });
      return HttpResponse.json({
        eintraege: { ...serverStand.eintraege, [String(params.schluessel)]: body.wert },
        geaendert_at: '2026-10-04 18:00:00',
      });
    }),
  ];
}

function wrapper() {
  const client = neuerQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { client, Wrapper };
}

describe('useStandardRufname', () => {
  it('liest den Standard aus dem Fach der Person', async () => {
    server.use(
      ...handler({
        eintraege: { [SCHLUESSEL_ETB_STANDARD_RUFNAME]: '{"von":"ELW 1","an":"S2"}' },
      }),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStandardRufname(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.geladen).toBe(true));
    expect(result.current.standard).toEqual({ von: 'ELW 1', an: 'S2' });
  });

  it('ohne Eintrag: geladen, aber kein Standard', async () => {
    server.use(...handler({ eintraege: {} }));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStandardRufname(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.geladen).toBe(true));
    expect(result.current.standard).toBeNull();
  });

  it('Setzen schreibt den Schlüssel und lässt das Gedächtnis der Palette stehen', async () => {
    server.use(...handler({ eintraege: { zuletzt_befehle: '["nav:profil"]' } }));
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useStandardRufname(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.geladen).toBe(true));

    await act(() => result.current.setze('{"von":"ELW 1","an":"ELW 1"}'));

    expect(puts).toEqual([
      { schluessel: SCHLUESSEL_ETB_STANDARD_RUFNAME, wert: '{"von":"ELW 1","an":"ELW 1"}' },
    ]);
    await waitFor(() => expect(result.current.standard).toEqual({ von: 'ELW 1', an: 'ELW 1' }));
    const fach = client.getQueryData<BenutzerEinstellungen>(
      globalKeys.benutzerEinstellungenVon(nutzer.id),
    );
    expect(fach?.eintraege.zuletzt_befehle).toBe('["nav:profil"]');
  });

  it('ein abgelehntes Setzen lässt keinen Standard stehen und lehnt ab', async () => {
    server.use(...handler({ eintraege: {} }, 400));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStandardRufname(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.geladen).toBe(true));

    await expect(result.current.setze('{"von":"ELW 1","an":"ELW 1"}')).rejects.toBeTruthy();
    expect(result.current.standard).toBeNull();
  });
});
