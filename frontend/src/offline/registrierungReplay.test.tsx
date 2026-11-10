import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { OFFLINE_QUEUE_BENUTZER_HEADER } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { server } from '../test/server';
import {
  queueLeerenFuerTests,
  queueZaehlerLaden,
  schreibaktionEinreihen,
  schreibaktionenAbgelehntLaden,
} from './queue';
import { useOfflineSync } from './useOfflineSync';

/**
 * LLH-1612, Spec `betreuung-registrierung`, „Ohne Netz registrieren“: ein vorgemerkter Haushalt
 * geht beim Abgleich als EIN Request mit derselben `client_id` hinaus, die Registrierliste der
 * Stelle lädt neu, BEVOR die Zeile verschwindet, und eine Ablehnung landet mit Stelle im
 * Wiederherstellungsbereich. Geprüft am Draht (MSW) wie `standReplay.test.tsx`.
 */

const BENUTZER = 11;
const REG = '/api/einsaetze/7/betreuung/stellen/8/registrierungen';
const AB = '/api/einsaetze/7/betreuung/stellen/8/abmeldungen';

function wrapper(client: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const neuerClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  await queueLeerenFuerTests();
});

describe('Abgleich vorgemerkter Registrierungen (LLH-1612)', () => {
  it('sendet den Haushalt genau einmal mit client_id und Erfassungszeit und lädt die Liste vor dem Entfernen', async () => {
    await schreibaktionEinreihen(BENUTZER, 7, {
      art: 'registrierung',
      stelle_id: 8,
      bezeichnung: 'Turnhalle Ost',
      daten: {
        personen: [
          { name: 'Weber', vorname: 'Anna', kostform: 'vegetarisch' },
          { name: 'Weber', vorname: 'Tom', kostform: 'normal' },
        ],
        client_id: 'reg-offline',
        zeitpunkt_at: '2026-11-09 09:15:00',
      },
    });
    const gesendet: { body: unknown; besitzer: string | null }[] = [];
    server.use(
      http.post(REG, async ({ request }) => {
        gesendet.push({
          body: await request.json(),
          besitzer: request.headers.get(OFFLINE_QUEUE_BENUTZER_HEADER),
        });
        return HttpResponse.json(
          { id: 3, nummer: 1, personen: [] },
          {
            status: 201,
          },
        );
      }),
    );
    const client = neuerClient();
    client.setQueryData(einsatzKeys.registrierliste(7, 8), {
      stelle_id: 8,
      haushalte: [],
      ohne_haushalt: [],
    });

    renderHook(() => useOfflineSync(BENUTZER), { wrapper: wrapper(client) });

    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 0 }),
    );
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0].body).toMatchObject({
      client_id: 'reg-offline',
      zeitpunkt_at: '2026-11-09 09:15:00',
      personen: [{ name: 'Weber' }, { name: 'Weber' }],
    });
    expect(gesendet[0].besitzer).toBe(String(BENUTZER));
    expect(client.getQueryState(einsatzKeys.registrierliste(7, 8))?.isInvalidated).toBe(true);
  });

  it('eine Ablehnung (Stelle geschlossen) geht mit Stelle in den Wiederherstellungsbereich', async () => {
    await schreibaktionEinreihen(BENUTZER, 7, {
      art: 'abmeldung',
      stelle_id: 8,
      bezeichnung: 'Turnhalle Ost',
      daten: { haushalt_id: 3, client_id: 'ab-offline', zeitpunkt_at: '2026-11-09 09:15:00' },
    });
    server.use(
      http.post(AB, () =>
        HttpResponse.json({ error: 'Betreuungsstelle ist geschlossen' }, { status: 422 }),
      ),
    );

    renderHook(() => useOfflineSync(BENUTZER), { wrapper: wrapper(neuerClient()) });

    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 1 }),
    );
    const [abgelehnt] = await schreibaktionenAbgelehntLaden(BENUTZER, 7);
    expect(abgelehnt.aktion).toMatchObject({ art: 'abmeldung', bezeichnung: 'Turnhalle Ost' });
    expect(abgelehnt.grund).toContain('geschlossen');
  });
});
