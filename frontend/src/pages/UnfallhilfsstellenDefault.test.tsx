import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import UnfallhilfsstellenDefault from './UnfallhilfsstellenDefault';
import { merkeLetzteUhs } from './uhs/uhsAuswahl';
import type { Uhs, UhsStatus } from '../api/types';
import { App as AntApp } from 'antd';

function uhs(id: number, status: UhsStatus): Uhs {
  return {
    id, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
    bezeichnung: `UHS ${id}`, standort: null, notiz: null, lat: null, lon: null, status,
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
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
            <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<DetailStub />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>
  );
  return qc;
}

describe('UnfallhilfsstellenDefault', () => {
  beforeEach(() => localStorage.clear());

  it('leitet auf die älteste aktive UHS um, wenn keine zuletzt ausgewählte gemerkt ist', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
      uhs(7, 'aktiv'), uhs(3, 'aktiv'), uhs(9, 'geplant'),
    ])));
    renderDefault();
    expect(await screen.findByText('DETAIL-3')).toBeInTheDocument();
  });

  it('bevorzugt die zuletzt ausgewählte UHS — auch vor einer aktiven', async () => {
    merkeLetzteUhs(1, 9);
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
      uhs(3, 'aktiv'), uhs(9, 'geplant'),
    ])));
    renderDefault();
    expect(await screen.findByText('DETAIL-9')).toBeInTheDocument();
  });

  it('leitet auf die zuletzt angelegte UHS um, wenn keine aktive existiert', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
      uhs(2, 'geplant'), uhs(7, 'aufgeloest'), uhs(4, 'geplant'),
    ])));
    renderDefault();
    expect(await screen.findByText('DETAIL-7')).toBeInTheDocument();
  });

  it('zeigt bei 0 UHS einen Leerzustand, dessen CTA den Anlegen-Drawer öffnet', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])));
    renderDefault();
    await userEvent.click(await screen.findByRole('button', { name: 'Erste UHS anlegen' }));
    expect(await screen.findByText('Unfallhilfsstelle anlegen')).toBeInTheDocument();
  });

  it('springt nicht automatisch ins Detail, wenn nachträglich eine aktive UHS auftaucht', async () => {
    server.use(http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    renderDefault(qc);
    await screen.findByRole('button', { name: 'Erste UHS anlegen' });

    // Live-Update simulieren: der Cache erhält nachträglich eine aktive UHS.
    act(() => {
      qc.setQueryData(['einsatz-uhs', 1], [uhs(5, 'aktiv')]);
    });

    await waitFor(() => expect(screen.queryByText('DETAIL-5')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Erste UHS anlegen' })).toBeInTheDocument();
  });
});
