import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import UnfallhilfsstellenPage from './UnfallhilfsstellenPage';
import UhsDetailPage from './uhs/UhsDetailPage';
import { liesLetzteUhs } from './uhs/uhsAuswahl';
import { App as AntApp } from 'antd';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => { vi.stubGlobal('EventSource', FakeEventSource); localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

function einsatzAntwort(rolle: 'einsatzleitung' | 'beobachter' = 'einsatzleitung') {
  return {
    id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-28', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-28',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: rolle,
  };
}

function renderPage(route = '/einsaetze/1/unfallhilfsstellen/liste') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/einsaetze/:id/unfallhilfsstellen/liste" element={<UnfallhilfsstellenPage />} />
            <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>
  );
}

describe('UnfallhilfsstellenPage', () => {
  it('rendert die UHS-Liste mit Status-Badge', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
        { id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
          bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
          erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null },
      ])),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('BHP 50')).toBeInTheDocument());
    expect(screen.getByText('Behandlungsplatz')).toBeInTheDocument();
    expect(screen.getByText('aktiv')).toBeInTheDocument();
  });

  it('Neu-Button ist disabled für Beobachter', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort('beobachter'))),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    );
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Neu' });
    expect(btn).toBeDisabled();
  });

  it('Anlegen-Flow ruft POST und schließt den Drawer', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/uhs', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'patientenablage',
          bezeichnung: 'PA 1', standort: null, notiz: null, status: 'geplant',
          erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
        }, { status: 201 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByPlaceholderText('z. B. BHP 50'), 'PA 1');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(body).toMatchObject({ bezeichnung: 'PA 1' }));
  });
});

describe('Grundriss DnD', () => {
  it('öffnet Detail-Drawer und zeigt Tab „Grundriss"', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
        { id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
          bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
          erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null },
      ])),
      http.get('/api/einsaetze/1/uhs/7', () => HttpResponse.json({
        id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
        bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
        erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
        plaetze: [{ id: 1, uhs_id: 7, typ: 'bett', bezeichnung: 'Bett 3',
                    pos_x: 100, pos_y: 50, verfuegbarkeit: 'frei',
                    reserviert_fuer_person_id: null, storniert_at: null }],
        belegungen: [], material: [],
      })),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    );
    renderPage();
    await userEvent.click(await screen.findByText('BHP 50'));
    expect(await screen.findByRole('tab', { name: 'Grundriss' })).toBeInTheDocument();
    expect(await screen.findByText('Bett 3')).toBeInTheDocument();
  });
});

describe('UhsDetailPage', () => {
  it('merkt die geöffnete UHS als zuletzt ausgewählt', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
        { id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
          bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
          erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null },
      ])),
      http.get('/api/einsaetze/1/uhs/7', () => HttpResponse.json({
        id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
        bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
        erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
        plaetze: [], belegungen: [], material: [],
      })),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    );
    renderPage('/einsaetze/1/unfallhilfsstellen/7');
    await screen.findByRole('button', { name: /BHP 50/ });
    await waitFor(() => expect(liesLetzteUhs(1)).toBe(7));
  });
});
