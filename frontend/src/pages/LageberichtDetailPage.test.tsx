import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import LageberichtDetailPage from './LageberichtDetailPage';

vi.mock('../api/einsaetze');
vi.mock('../api/lageberichte');

function renderBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/einsaetze/:id/lageberichte" element={<div>LB-LISTE</div>} />
            <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('LageberichtDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger Lagebericht-ID auf die Liste um', async () => {
    renderBei('/einsaetze/1/lageberichte/abc');
    expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
  });
});
