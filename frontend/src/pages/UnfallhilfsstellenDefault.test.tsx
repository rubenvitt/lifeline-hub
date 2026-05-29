import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import UnfallhilfsstellenDefault from './UnfallhilfsstellenDefault';
import type { Uhs } from '../api/types';
import { App as AntApp } from 'antd';

function uhs(partial: Partial<Uhs>): Uhs {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
    bezeichnung: 'X', standort: null, notiz: null, status: 'aktiv',
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
    ...partial,
  };
}

/** Leichtgewichtiger Detail-Stub, der die getroffene uhsId sichtbar macht. */
function DetailStub() {
  const { uhsId } = useParams();
  return <div>DETAIL-{uhsId}</div>;
}

function renderDefault(client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/unfallhilfsstellen']}>
          <Routes>
            <Route path="/einsaetze/:id/unfallhilfsstellen" element={<UnfallhilfsstellenDefault />} />
            <Route path="/einsaetze/:id/unfallhilfsstellen/liste" element={<div>LISTE-STUB</div>} />
            <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<DetailStub />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>
  );
  return qc;
}

describe('UnfallhilfsstellenDefault', () => {
  it('leitet bei mehreren aktiven UHS auf die alphabetisch erste aktive um', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
      uhs({ id: 7, bezeichnung: 'BHP 50', status: 'aktiv' }),
      uhs({ id: 3, bezeichnung: 'Abschnitt Nord', status: 'aktiv' }),
      uhs({ id: 9, bezeichnung: 'Zelt West', status: 'geplant' }),
    ])));
    renderDefault();
    expect(await screen.findByText('DETAIL-3')).toBeInTheDocument();
  });

  it('zeigt bei 0 UHS einen Leerzustand mit „Erste UHS anlegen“-CTA', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])));
    renderDefault();
    expect(await screen.findByRole('button', { name: 'Erste UHS anlegen' })).toBeInTheDocument();
  });

  it('zeigt die Liste, wenn UHS existieren aber keine aktiv ist', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
      uhs({ id: 1, bezeichnung: 'Geplant 1', status: 'geplant' }),
      uhs({ id: 2, bezeichnung: 'Alt', status: 'aufgeloest' }),
    ])));
    renderDefault();
    expect(await screen.findByText('LISTE-STUB')).toBeInTheDocument();
  });

  it('springt nicht automatisch ins Detail, wenn nachträglich eine aktive UHS auftaucht', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    renderDefault(qc);
    await screen.findByRole('button', { name: 'Erste UHS anlegen' });

    // Live-Update simulieren: der Cache erhält nachträglich eine aktive UHS.
    act(() => {
      qc.setQueryData(['einsatz-uhs', 1], [uhs({ id: 5, bezeichnung: 'Neu', status: 'aktiv' })]);
    });

    await waitFor(() => expect(screen.queryByText('DETAIL-5')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Erste UHS anlegen' })).toBeInTheDocument();
  });
});
