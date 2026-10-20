import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { http, HttpResponse } from 'msw';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { OFFLINE_QUEUE_BENUTZER_HEADER } from '../api/client';
import { server } from '../test/server';
import { queueLeerenFuerTests, queueZaehlerLaden } from './queue';
import { useOfflineSync } from './useOfflineSync';

/**
 * LLH-1034: Die Bezirksrouten sind von `…/betreuung/bezirke/…` nach `…/evakuierung/bezirke/…`
 * umgezogen. Eine Standmeldung, die ein Gerät VOR dem Umzug offline vorgemerkt hat, liegt noch in
 * IndexedDB. Sie trägt keine URL, nur Bezirk und Body; nachgesendet wird sie deshalb an die neue
 * Route. Geprüft am Draht (MSW), nicht am gemockten API-Modul: nur so sieht der Test den Pfad.
 */

const BENUTZER = 11;
const NEU = '/api/einsaetze/7/evakuierung/bezirke/3/staende';
const ALT = '/api/einsaetze/7/betreuung/bezirke/3/staende';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Schreibt den Datensatz roh, in der Form, die das Bundle vor LLH-1034 abgelegt hat. */
async function altenStandAblegen(): Promise<void> {
  const d = await openDB('lifeline-offline');
  try {
    await d.add('schreibaktionen', {
      benutzer_id: BENUTZER,
      einsatz_id: 7,
      aktion: {
        art: 'stand',
        bezirk_id: 3,
        bezeichnung: 'Uferstraße 12–40',
        daten: {
          evakuiert: 212,
          erhebung: 'gezaehlt',
          zeitpunkt_at: '2026-10-20 08:30:00',
          client_id: 'stand-vor-umzug',
        },
      },
      erstellt_at: '2026-10-20T08:30:05.000Z',
    });
  } finally {
    d.close();
  }
}

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  await queueLeerenFuerTests();
});

describe('Offline vorgemerkter Stand nach dem Umzug ins Modul Evakuierung (LLH-1034)', () => {
  it('geht beim Nachsenden an …/evakuierung, nie an die alte Route, mit Queue-Besitzer und client_id', async () => {
    await altenStandAblegen();
    const neu: { body: unknown; besitzer: string | null }[] = [];
    let alt = 0;
    server.use(
      http.post(NEU, async ({ request }) => {
        neu.push({
          body: await request.json(),
          besitzer: request.headers.get(OFFLINE_QUEUE_BENUTZER_HEADER),
        });
        return HttpResponse.json({ meldung_id: 1, bezirk: { id: 3 } }, { status: 201 });
      }),
      http.post(ALT, () => {
        alt += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );

    renderHook(() => useOfflineSync(BENUTZER), { wrapper: wrapper() });

    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 0 }),
    );
    expect(alt).toBe(0);
    expect(neu).toHaveLength(1);
    expect(neu[0].body).toMatchObject({ evakuiert: 212, client_id: 'stand-vor-umzug' });
    expect(neu[0].besitzer).toBe(String(BENUTZER));
  });
});
