import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import BereitstellungsraeumeDefault from './BereitstellungsraeumeDefault';
import { merkeLetztenBr } from './brAuswahl';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';
import { App as AntApp } from 'antd';

function br(id: number, status: BrStatus): Bereitstellungsraum {
  return {
    id,
    einsatz_id: 1,
    abschnitt_id: null,
    bezeichnung: `BR ${id}`,
    standort: null,
    notiz: null,
    status,
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
  };
}

/** Leichtgewichtiger Detail-Stub, der die getroffene brId sichtbar macht. */
function DetailStub() {
  const { brId } = useParams();
  return <div>DETAIL-{brId}</div>;
}

function renderDefault(client?: QueryClient) {
  const qc =
    client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/bereitstellungsraeume']}>
          <Routes>
            <Route
              path="/einsaetze/:id/bereitstellungsraeume"
              element={<BereitstellungsraeumeDefault />}
            />
            <Route path="/einsaetze/:id/bereitstellungsraeume/:brId" element={<DetailStub />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
  return qc;
}

describe('BereitstellungsraeumeDefault', () => {
  beforeEach(() => localStorage.clear());

  it('leitet auf den ältesten aktiven BR um, wenn keiner zuletzt ausgewählt ist', async () => {
    server.use(
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br(7, 'aktiv'), br(3, 'aktiv'), br(9, 'geplant')]),
      ),
    );
    renderDefault();
    expect(await screen.findByText('DETAIL-3')).toBeInTheDocument();
  });

  it('bevorzugt den zuletzt ausgewählten BR — auch vor einem aktiven', async () => {
    merkeLetztenBr(1, 9);
    server.use(
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br(3, 'aktiv'), br(9, 'geplant')]),
      ),
    );
    renderDefault();
    expect(await screen.findByText('DETAIL-9')).toBeInTheDocument();
  });

  it('leitet auf den zuletzt angelegten BR um, wenn keiner aktiv ist', async () => {
    server.use(
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br(2, 'geplant'), br(7, 'aufgeloest'), br(4, 'geplant')]),
      ),
    );
    renderDefault();
    expect(await screen.findByText('DETAIL-7')).toBeInTheDocument();
  });

  it('zeigt bei 0 BR einen Leerzustand, dessen CTA den Anlegen-Drawer öffnet', async () => {
    server.use(http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])));
    renderDefault();
    await userEvent.click(await screen.findByRole('button', { name: 'Ersten BR anlegen' }));
    expect(await screen.findByText('Bereitstellungsraum anlegen')).toBeInTheDocument();
  });

  /**
   * AK4-Partnerpaar (LFH-331 · B3). Vor dem Umbau zeigte der Fehlerfall eine Meldung
   * ohne Wiederholung; der Leertext war ein antd-Leer-Element mit eingebettetem Knopf.
   * Beide Hälften nennen dasselbe Literal, damit die negative Zusicherung eine Aussage
   * über die Weiche bleibt und nicht über die Schreibweise des Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get(
        '/api/einsaetze/1/bereitstellungsraeume',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderDefault();
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Bereitstellungsräume erfasst')).not.toBeInTheDocument();
  });

  it('zeigt bei 0 BR den Leertext und KEINEN Fehler', async () => {
    server.use(http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])));
    renderDefault();
    expect(await screen.findByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('springt nicht automatisch ins Detail, wenn nachträglich ein aktiver BR auftaucht', async () => {
    server.use(http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    renderDefault(qc);
    await screen.findByRole('button', { name: 'Ersten BR anlegen' });

    // Live-Update simulieren: der Cache erhält nachträglich einen aktiven BR.
    act(() => {
      qc.setQueryData(['einsatz-br', 1], [br(5, 'aktiv')]);
    });

    await waitFor(() => expect(screen.queryByText('DETAIL-5')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Ersten BR anlegen' })).toBeInTheDocument();
  });
});
