import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { useSchnellaktionZaehler } from './useSchnellaktionZaehler';
import { SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER } from './schnellaktionZaehler';
import type { BenutzerEinstellungen } from '../api/types';
import { benutzerFixture } from '../test/fixtures';

const nutzer = benutzerFixture({ anzeigename: 'EL', org_rolle: 'fuehrungskraft' });

let puts: { schluessel: string; wert: string }[];
let gets: number;

beforeEach(() => {
  puts = [];
  gets = 0;
});

function stand(zaehlung: Record<string, number>): BenutzerEinstellungen {
  return { eintraege: { [SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER]: JSON.stringify(zaehlung) } };
}

function handler(serverStand: BenutzerEinstellungen | 'fehler') {
  return [
    meHandler(nutzer),
    http.get('/api/benutzer-einstellungen', () => {
      gets += 1;
      return serverStand === 'fehler'
        ? HttpResponse.json({ fehler: 'kaputt' }, { status: 500 })
        : HttpResponse.json(serverStand);
    }),
    http.put('/api/benutzer-einstellungen/:schluessel', async ({ params, request }) => {
      const body = (await request.json()) as { wert: string };
      puts.push({ schluessel: String(params.schluessel), wert: body.wert });
      return HttpResponse.json({ eintraege: { [String(params.schluessel)]: body.wert } });
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

const flush = () =>
  new Promise((r) => {
    setTimeout(r, 40);
  });

describe('useSchnellaktionZaehler', () => {
  it('liest die Zählung aus dem Serverstand', async () => {
    server.use(...handler(stand({ 'aktion:etb': 3 })));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSchnellaktionZaehler(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.zaehlung).toEqual({ 'aktion:etb': 3 }));
  });

  it('zählt eine Ausführung hoch und schickt den neuen Stand', async () => {
    server.use(...handler(stand({ 'aktion:etb': 3 })));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSchnellaktionZaehler(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.zaehlung).toEqual({ 'aktion:etb': 3 }));

    result.current.zaehle('aktion:etb');

    await waitFor(() => expect(result.current.zaehlung).toEqual({ 'aktion:etb': 4 }));
    await waitFor(() =>
      expect(puts).toEqual([
        { schluessel: SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER, wert: '{"aktion:etb":4}' },
      ]),
    );
  });

  /** Zwei rasche Ausführungen hängen am selben Stand; die zweite muss die erste sehen. */
  it('zählt zwei rasche Ausführungen beide', async () => {
    server.use(...handler(stand({})));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSchnellaktionZaehler(), { wrapper: Wrapper });
    // Ohne Sitzung gibt es kein Fach; gezählt wird erst mit angemeldetem Benutzer.
    await waitFor(() => expect(gets).toBe(1));

    result.current.zaehle('aktion:etb');
    result.current.zaehle('aktion:personen');

    await waitFor(() =>
      expect(result.current.zaehlung).toEqual({ 'aktion:etb': 1, 'aktion:personen': 1 }),
    );
    await waitFor(() => expect(puts).toHaveLength(2));
    // Die Reihenfolge der Ankunft ist nicht garantiert; der zweite Schreibvorgang trägt beide.
    expect(puts.map((p) => JSON.parse(p.wert) as unknown)).toContainEqual({
      'aktion:etb': 1,
      'aktion:personen': 1,
    });
  });

  /** Vollersatz aus dem Nichts löschte alle Zahlen: ohne bekannten Bestand wird nicht geschrieben. */
  it('schreibt nicht, wenn der Bestand nicht zu lesen ist', async () => {
    server.use(...handler('fehler'));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSchnellaktionZaehler(), { wrapper: Wrapper });
    await waitFor(() => expect(gets).toBeGreaterThan(0));

    result.current.zaehle('aktion:etb');
    await flush();

    expect(puts).toEqual([]);
  });

  it('zählt keine unbekannte Id', async () => {
    server.use(...handler(stand({ 'aktion:etb': 1 })));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSchnellaktionZaehler(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.zaehlung).toEqual({ 'aktion:etb': 1 }));

    result.current.zaehle('nav:profil');
    await flush();

    expect(result.current.zaehlung).toEqual({ 'aktion:etb': 1 });
  });
});
