import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import UhsDetailPage from './UhsDetailPage';
import { AuthProvider } from '../../auth/AuthContext';
import { ladeEinsatz } from '../../api/einsaetze';
import { ladeUhs } from '../../api/einsatzUhs';

// Auto-Mocks: für den Robustheits-Guard reicht no-op-API — bei ungültiger ID wird ohnehin
// vor jedem Laden auf die Liste umgeleitet.
vi.mock('../../api/einsaetze');
vi.mock('../../api/einsatzUhs');
// Kind-Komponenten stubben: LFH-149 testet die Seiten-Komposition (Tabs statt Drawer),
// nicht die Datenflüsse von Grundriss/Material/Bewegungen.
vi.mock('./Grundriss', () => ({ default: () => <div>GRUNDRISS</div> }));
vi.mock('./MaterialTab', () => ({ default: () => <div>MATERIAL-TAB</div> }));
vi.mock('./BewegungenTab', () => ({ default: () => <div>BEWEGUNGEN-TAB</div> }));
vi.mock('./UhsSwitcher', () => ({ default: () => <div>SWITCHER</div> }));

function renderBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/einsaetze/:id/unfallhilfsstellen/liste" element={<div>UHS-LISTE</div>} />
              <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
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

describe('UhsDetailPage — Material/Bewegungen als Inline-Tabs (LFH-149)', () => {
  const einsatz = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
  const uhs = { id: 9, einsatz_id: 1, bezeichnung: 'UHS Nord', typ: 'sammelplatz', status: 'aktiv', standort: 'Halle 1', notiz: null };

  it('zeigt Material/Bewegungen als Tabs (kein Drawer) und schaltet zwischen ihnen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(uhs as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    // Grundriss bleibt Hauptinhalt; Material/Bewegungen sind Tabs (role=tab), keine Drawer-Buttons.
    expect(await screen.findByText('GRUNDRISS')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Material' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bewegungen' })).toBeInTheDocument();
    // Default-Tab (Material) inline sichtbar — kein Drawer (sonst kein Tab-Panel).
    expect(screen.getByText('MATERIAL-TAB')).toBeInTheDocument();
    expect(screen.queryByText('BEWEGUNGEN-TAB')).not.toBeInTheDocument();
    // Tab-Wechsel zeigt die Bewegungen inline.
    await userEvent.click(screen.getByRole('tab', { name: 'Bewegungen' }));
    expect(await screen.findByText('BEWEGUNGEN-TAB')).toBeInTheDocument();
  });
});
