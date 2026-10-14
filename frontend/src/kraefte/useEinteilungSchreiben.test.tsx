import { http, HttpResponse } from 'msw';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useEinteilungSchreiben } from './useEinteilungSchreiben';

let aufrufe: string[];

beforeEach(() => {
  aufrufe = [];
  const merke = ({ request }: { request: Request }) => {
    aufrufe.push(`${request.method} ${new URL(request.url).pathname}`);
    return new HttpResponse(null, { status: 204 });
  };
  server.use(
    http.put('/api/einsaetze/1/einheiten/:eid/personal/:ep', merke),
    http.delete('/api/einsaetze/1/einheiten/:eid/personal/:ep', merke),
    http.put('/api/einsaetze/1/fahrzeuge/:ef/besatzung/:ep', merke),
    http.delete('/api/einsaetze/1/fahrzeuge/:ef/besatzung/:ep', merke),
    http.put('/api/einsaetze/1/uhs/:uid/kraefte/:ep', ({ request }) => {
      aufrufe.push(`PUT ${new URL(request.url).pathname}`);
      return HttpResponse.json({ id: 9 });
    }),
    http.delete('/api/einsaetze/1/uhs/:uid/kraefte/:ep', merke),
  );
});

function hook() {
  const client = neuerQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useEinteilungSchreiben(1), { wrapper }).result.current;
}

describe('useEinteilungSchreiben (LLH-1060, D3)', () => {
  it('Einheit: Wechsel ist ein PUT auf das neue Ziel, Leeren ein DELETE mit der alten', async () => {
    const s = hook();
    await act(() => s.einheit(9)(12, 11));
    await act(() => s.einheit(9)(null, 12));
    expect(aufrufe).toEqual([
      'PUT /api/einsaetze/1/einheiten/12/personal/9',
      'DELETE /api/einsaetze/1/einheiten/12/personal/9',
    ]);
  });

  it('Fahrzeug und UHS über ihre Zuordnungswege', async () => {
    const s = hook();
    await act(() => s.fahrzeug(9)(5, null));
    await act(() => s.fahrzeug(9)(null, 5));
    await act(() => s.uhs(9)(3, null));
    await act(() => s.uhs(9)(null, 3));
    expect(aufrufe).toEqual([
      'PUT /api/einsaetze/1/fahrzeuge/5/besatzung/9',
      'DELETE /api/einsaetze/1/fahrzeuge/5/besatzung/9',
      'PUT /api/einsaetze/1/uhs/3/kraefte/9',
      'DELETE /api/einsaetze/1/uhs/3/kraefte/9',
    ]);
  });

  it('unverändert schreibt nichts', async () => {
    const s = hook();
    await act(() => s.einheit(9)(12, 12));
    await act(() => s.fahrzeug(9)(null, null));
    expect(aufrufe).toEqual([]);
  });

  it('eine Ablehnung lehnt ab', async () => {
    server.use(
      http.put('/api/einsaetze/1/einheiten/:eid/personal/:ep', () =>
        HttpResponse.json({ error: 'Kraft ist entlassen' }, { status: 409 }),
      ),
    );
    const s = hook();
    await expect(s.einheit(9)(12, null)).rejects.toThrow(/entlassen/);
  });
});
