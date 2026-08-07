import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import UnfallhilfsstellenPage from './UnfallhilfsstellenPage';
import UhsDetailPage from './uhs/UhsDetailPage';
import { liesLetzteUhs } from './uhs/uhsAuswahl';
import { AuthProvider } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { App as AntApp } from 'antd';
import { useState } from 'react';
import UhsAnlegenDrawer from './uhs/UhsAnlegenDrawer';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';

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

/** Eine UHS-Zeile — die Kennung `BHP 50` ist in mehreren Tests der Beleg „Zeile steht". */
const bhp50 = {
  id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
  bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
  erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
};

function renderPage(route = '/einsaetze/1/unfallhilfsstellen/liste') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/einsaetze/:id/unfallhilfsstellen/liste" element={<UnfallhilfsstellenPage />} />
              <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>
  ) };
}

function UhsDrawerHarness(props: { onClose: () => void; onAngelegt: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <UhsAnlegenDrawer
      einsatzId={1}
      open={open}
      onClose={() => { props.onClose(); setOpen(false); }}
      onAngelegt={props.onAngelegt}
    />
  );
}

function UhsEinsatzWechselHarness() {
  const [einsatzId, setEinsatzId] = useState(1);
  return (
    <>
      <button type="button" onClick={() => setEinsatzId(2)}>Zu Einsatz B</button>
      <UhsAnlegenDrawer einsatzId={einsatzId} open onClose={() => {}} />
    </>
  );
}

function renderUhsDrawer(onClose: () => void, onAngelegt: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <CommandPaletteProvider>
          <UhsDrawerHarness onClose={onClose} onAngelegt={onAngelegt} />
        </CommandPaletteProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('UnfallhilfsstellenPage', () => {
  it('schließt den UHS-Drawer mit Provider per Escape genau einmal', async () => {
    const onClose = vi.fn();
    renderUhsDrawer(onClose, vi.fn());
    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveFocus());

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('setzt beim Einsatzwechsel alle Werte des offenen UHS-Drawers zurück', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AntApp><UhsEinsatzWechselHarness /></AntApp>
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'UHS Einsatz A');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), 'Standort A');
    await userEvent.type(screen.getByLabelText('Notiz (optional)'), 'Notiz A');

    fireEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));

    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(screen.getByLabelText('Standort (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Notiz (optional)')).toHaveValue('');
    expect(screen.getByTitle('Behandlungsplatz')).toBeInTheDocument();
  });

  it('öffnet via ?neu=1 den Anlegen-Drawer (aktiver Einsatz)', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    );
    renderPage('/einsaetze/1/unfallhilfsstellen/liste?neu=1');
    expect(await screen.findByText('Unfallhilfsstelle anlegen')).toBeInTheDocument();
  });

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

  /**
   * AK4-Regressionsklammer (LFH-331 · B3) zur Ebenen-Trennung D3: die Listen-Query
   * entscheidet an der Stelle der Liste, nicht im Seitenguard. Vor dem Umbau kam die
   * Seite bei gescheitertem UHS-Abruf ohne jede Aussage heraus.
   *
   * Der Leertext ist byte-gleich der aus `UnfallhilfsstellenDefault` — eine zweite
   * Formulierung für dieselbe Tatsache wäre der Befund, den B3 behebt.
   */
  it('zeigt bei gescheitertem UHS-Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => new HttpResponse(null, { status: 500 })),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Unfallhilfsstellen erfasst')).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher (D5) — nicht `isFetching`,
   * nicht `isStale`.
   *
   * Der Ablauf ist BEWUSST der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung. Ein bloß vorbefüllter Zwischenspeicher belegte den Produktionsweg nicht —
   * dort steht hinter den Zeilen immer ein erfolgreicher Abruf.
   *
   * Gemessen wird an der UNGEFILTERTEN Menge; nur so kippt die Seite nicht in den
   * Fehlerzweig, sobald eine engere Sicht zufällig 0 Treffer hat.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([bhp50])),
    );
    const { qc } = renderPage();
    await screen.findByText('BHP 50');

    server.use(
      http.get('/api/einsaetze/1/uhs', () => new HttpResponse(null, { status: 500 })),
    );
    await qc.refetchQueries({ queryKey: einsatzKeys.uhs(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('BHP 50')).toBeInTheDocument();
    expect(screen.queryByText('Unfallhilfsstellen konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Liste den Leertext und KEINEN Fehler', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText('Noch keine Unfallhilfsstellen erfasst')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('fokussiert Bezeichnung und legt per Enter aus diesem Feld an', async () => {
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
    const bezeichnung = screen.getByPlaceholderText('z. B. BHP 50');
    await waitFor(() => expect(bezeichnung).toHaveFocus());
    await userEvent.keyboard('PA 1{Enter}');
    await waitFor(() => expect(body).toMatchObject({ bezeichnung: 'PA 1' }));
  });

  it('lässt den Drawer und die Bezeichnung bei einem Anlegefehler stehen', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/uhs', () =>
        HttpResponse.json({ error: 'UHS abgelehnt' }, { status: 500 })),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    const bezeichnung = screen.getByPlaceholderText('z. B. BHP 50');
    await userEvent.type(bezeichnung, 'PA Fehler');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByText('UHS abgelehnt')).toBeInTheDocument();
    expect(bezeichnung).toHaveValue('PA Fehler');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('meldet nach Schließen während des Anlegens keinen verspäteten Abschluss', async () => {
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => { postGestartet = resolve; });
    const antwortGate = new Promise<void>((resolve) => { antwortFreigeben = resolve; });
    const onClose = vi.fn();
    const onAngelegt = vi.fn();
    server.use(http.post('/api/einsaetze/1/uhs', async () => {
      postGestartet();
      await antwortGate;
      return HttpResponse.json(bhp50, { status: 201 });
    }));
    renderUhsDrawer(onClose, onAngelegt);

    await userEvent.type(screen.getByPlaceholderText('z. B. BHP 50'), 'PA 1{Enter}');
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));
    await act(async () => { antwortFreigeben(); });
    await screen.findByText('UHS angelegt');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAngelegt).not.toHaveBeenCalled();
  });
});

describe('Grundriss DnD', () => {
  it('öffnet Detail und zeigt den Grundriss mit Plätzen', async () => {
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
    // Grundriss ist jetzt immer sichtbar (keine Tabs mehr) — die Mittelspalte trägt
    // den Titel „Unfallhilfsstelle" und zeigt die angelegten Plätze direkt.
    expect(await screen.findByText('Unfallhilfsstelle')).toBeInTheDocument();
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
