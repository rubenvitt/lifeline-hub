import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { einsatzKeys } from '../api/queryKeys';
import { ApiError } from '../api/client';
import type { MaterialOrtRef } from './materialPosten';
import { useMaterialOrt } from './useMaterialOrt';

/**
 * Der eine Schreibweg eines Orts (LLH-1225 D2): jeder Aufrufer schickt über `setOrt` den PATCH an
 * die Disposition; was er sendet, baut `ortPatch` aus Ziel und bisherigem Ort.
 */
const posten = (ort: Partial<Record<string, number>> = {}) => ({
  id: 10,
  einheit_id: null,
  einsatz_fahrzeug_id: null,
  uhs_id: null,
  br_id: null,
  ...ort,
});

function renderSetOrt() {
  const gesendet: { url: string; body: unknown }[] = [];
  server.use(
    http.patch('/api/einsaetze/1/material/:emId', async ({ request }) => {
      gesendet.push({ url: new URL(request.url).pathname, body: await request.json() });
      return HttpResponse.json({});
    }),
  );
  const client = new QueryClient();
  const invalidiert = vi.spyOn(client, 'invalidateQueries');
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useMaterialOrt(1), { wrapper: Wrapper });
  const keys = () => invalidiert.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
  return { setOrt: result.current.setOrt, gesendet, keys };
}

describe('useMaterialOrt (LLH-1225 D2)', () => {
  const faelle: [string, ReturnType<typeof posten>, MaterialOrtRef | null, unknown][] = [
    ['an eine Einheit', posten(), { art: 'einheit', id: 2 }, { einheit_id: 2 }],
    [
      'auf ein Fahrzeug',
      posten({ einheit_id: 2 }),
      { art: 'fahrzeug', id: 3 },
      { einsatz_fahrzeug_id: 3 },
    ],
    ['an eine UHS', posten({ einheit_id: 2 }), { art: 'uhs', id: 7 }, { uhs_id: 7 }],
    ['in einen BR', posten({ uhs_id: 7 }), { art: 'bereitstellungsraum', id: 4 }, { br_id: 4 }],
    ['ohne Ort', posten({ br_id: 4 }), null, { br_id: null }],
  ];
  for (const [name, em, ziel, koerper] of faelle) {
    it(`schickt den Körper des Ortswechsels ${name} an die Disposition`, async () => {
      const { setOrt, gesendet } = renderSetOrt();
      await setOrt(em, ziel);
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/10', body: koerper }]);
    });
  }

  it('sendet nichts, wenn der Ort gleich bleibt', async () => {
    const { setOrt, gesendet } = renderSetOrt();
    await setOrt(posten({ uhs_id: 7 }), { art: 'uhs', id: 7 });
    await setOrt(posten(), null);
    expect(gesendet).toEqual([]);
  });

  it('gleicht Material, Einheiten, UHS, den alten und neuen Ort und das ETB ab', async () => {
    const { setOrt, keys } = renderSetOrt();
    await setOrt(posten({ uhs_id: 7 }), { art: 'bereitstellungsraum', id: 4 });
    const erwartet = [
      einsatzKeys.material(1),
      einsatzKeys.einheiten(1),
      einsatzKeys.uhs(1),
      einsatzKeys.uhsDetail(1, 7),
      einsatzKeys.brDetail(1, 4),
      einsatzKeys.etb(1),
    ].map((k) => JSON.stringify(k));
    expect(keys()).toEqual(expect.arrayContaining(erwartet));
  });

  it('reicht eine Ablehnung an den Aufrufer durch', async () => {
    server.use(
      http.patch('/api/einsaetze/1/material/:emId', () =>
        HttpResponse.json({ error: 'UHS ist aufgelöst' }, { status: 422 }),
      ),
    );
    const client = new QueryClient();
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMaterialOrt(1), { wrapper: Wrapper });
    await expect(result.current.setOrt(posten(), { art: 'uhs', id: 9 })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
