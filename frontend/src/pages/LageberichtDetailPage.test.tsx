import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import LageberichtDetailPage from './LageberichtDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import * as einsaetzeApi from '../api/einsaetze';
import * as lageberichteApi from '../api/lageberichte';

vi.mock('../api/einsaetze');
vi.mock('../api/lageberichte');

function bericht(over: Record<string, unknown> = {}) {
  return {
    id: 9, einsatz_id: 1, vorlage: 'lagebericht', titel: 'Lage 1', zeitstand: '2026-06-02 10:00:00',
    status: 'freigegeben', abschnitte: [], version: 1, vorgaenger_id: null, ersteller_id: 1,
    ersteller_name: 'EL', erstellt_at: '', aktualisiert_at: '', freigegeben_von_id: 1,
    freigegeben_von_name: 'EL', freigegeben_at: '2026-06-02 11:00:00', etb_eintrag_id: 5, ...over,
  };
}

function renderBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/einsaetze/:id/lageberichte" element={<div>LB-LISTE</div>} />
              <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('LageberichtDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger Lagebericht-ID auf die Liste um', async () => {
    renderBei('/einsaetze/1/lageberichte/abc');
    expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
  });

  it('verlinkt vom freigegebenen Lagebericht per ?eintrag= auf den ETB-Eintrag (LFH-25)', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(
      { id: 1, status: 'aktiv', meine_rolle: 'einsatzleitung', bezeichnung: 'Übung' } as never,
    );
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    renderBei('/einsaetze/1/lageberichte/9');
    const link = await screen.findByRole('link', { name: /ETB-Eintrag/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=5');
  });
});
