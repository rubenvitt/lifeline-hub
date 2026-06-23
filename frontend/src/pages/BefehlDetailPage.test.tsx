import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlDetailPage from './BefehlDetailPage';
import * as befehleApi from '../api/befehle';
import * as einsaetzeApi from '../api/einsaetze';

vi.mock('../api/befehle');
vi.mock('../api/einsaetze');

const einsatz = { id: 1, bezeichnung: 'Übung', status: 'aktiv', meine_rolle: 'einsatzleitung' };

function renderAt(bid: number | string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[`/einsaetze/1/auftraege/befehle/${bid}`]}>
          <Routes>
            <Route path="/einsaetze/:id/auftraege" element={<div>AUFTRAEGE-LISTE</div>} />
            <Route path="/einsaetze/:id/auftraege/befehle/:befehlId" element={<BefehlDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(einsatz as never);
});

function befehl(status: 'entwurf' | 'freigegeben') {
  return {
    id: 7, einsatz_id: 1, vorlage: 'befehl_ladef', titel: 'Befehl 1',
    zeitstand: '2026-06-02 10:00:00', status, abschnitte: [],
    version: 1, vorgaenger_id: null, ersteller_id: 1, ersteller_name: 'EL',
    erstellt_at: '', aktualisiert_at: '', freigegeben_von_id: null,
    freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: status === 'freigegeben' ? 5 : null,
  };
}

describe('BefehlDetailPage', () => {
  it('zeigt im Entwurf editierbare Felder mit Hilfetext', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    expect(await screen.findByText('Einsatzunterstützung')).toBeInTheDocument();
    expect(screen.getByText(/a\. Allgemeine Lage/)).toBeInTheDocument();
  });

  it('zeigt freigegeben read-only mit Fortschreiben', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    expect(await screen.findByRole('button', { name: 'Fortschreiben' })).toBeInTheDocument();
  });

  it('leitet bei ungültiger Befehl-ID auf die Auftrags-Liste um (LFH-25)', async () => {
    renderAt('abc');
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
  });
});
