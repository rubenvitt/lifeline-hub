import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import UhsDetailPage from './UhsDetailPage';

// Auto-Mocks: für den Robustheits-Guard reichen no-op-API + no-op-Stream — bei ungültiger
// ID wird ohnehin vor jedem Laden auf die Liste umgeleitet.
vi.mock('../../api/einsaetze');
vi.mock('../../api/einsatzUhs');
vi.mock('../../etb/useUhsStream');

function renderBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/einsaetze/:id/unfallhilfsstellen/liste" element={<div>UHS-LISTE</div>} />
            <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('UhsDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger UHS-ID auf die Liste um', async () => {
    renderBei('/einsaetze/1/unfallhilfsstellen/abc');
    expect(await screen.findByText('UHS-LISTE')).toBeInTheDocument();
  });
});
