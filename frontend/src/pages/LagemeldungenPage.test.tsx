import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router';
import LagemeldungenPage from './LagemeldungenPage';
import type { LageMeldung } from '../api/types';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter' }),
}));
const listeLageMeldungen = vi.fn();
vi.mock('../api/meldungen', () => ({ listeLageMeldungen: (...a: unknown[]) => listeLageMeldungen(...a) }));

const lage = (over: Partial<LageMeldung> = {}): LageMeldung => ({
  id: 1, einsatz_id: 1, meldung_id: 3, text: 'Brücke gesperrt', lat: null, lon: null,
  erstellt_von_id: 1, erstellt_at: '2026-06-12 09:00:00', meldung_lfd_nr: 5, meldung_absender: 'Florian Nord 1', ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><AntApp>
      <MemoryRouter initialEntries={['/einsaetze/1/lagemeldungen']}>
        <Routes><Route path="/einsaetze/:id/lagemeldungen" element={<LagemeldungenPage />} /></Routes>
      </MemoryRouter>
    </AntApp></QueryClientProvider>,
  );
}

describe('LagemeldungenPage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeLageMeldungen.mockResolvedValue([lage()]); });

  it('zeigt Lageobjekte mit nachvollziehbarer Herkunft', async () => {
    renderPage();
    expect(await screen.findByText('Brücke gesperrt')).toBeInTheDocument();
    expect(screen.getByText('Herkunft: Meldung #5 von Florian Nord 1')).toBeInTheDocument();
  });

  /**
   * Der Wortlaut bleibt byte-gleich; getauscht wird der Knoten (LFH-331 · B3). Die
   * zweite Zusicherung ist die tragende — die erste war vor dem Umbau genauso grün.
   *
   * Keine Primäraktion: eine Lagemeldung entsteht nicht hier, sondern dadurch, dass
   * jemand anderswo eine Meldung als lagerelevant übergibt. Ein Knopf auf die
   * Meldungsliste führte zur Voraussetzung, nicht aus dem Leerzustand heraus.
   */
  it('zeigt Leerzustand ohne Lageobjekte', async () => {
    listeLageMeldungen.mockResolvedValue([]);
    const { container } = renderPage();
    expect(await screen.findByText('Noch keine lagerelevanten Meldungen übergeben')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});
