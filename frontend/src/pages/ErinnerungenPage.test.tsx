import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App as AntApp } from 'antd';
import ErinnerungenPage from './ErinnerungenPage';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));
vi.mock('../api/erinnerungen', () => ({
  listeErinnerungen: vi.fn().mockResolvedValue([
    { id: 7, einsatz_id: 1, titel: 'Lagemeldung', beschreibung: null, faellig_at: '2026-06-11 10:00:00',
      intervall_minuten: 30, empfaenger_funktion: null, bezug_typ: null, bezug_id: null, quelle: 'manuell',
      status: 'offen', erledigt_at: null, erstellt_von_id: 1, erstellt_at: '2026-06-11 09:00:00', ist_faellig: true },
  ]),
  legeErinnerungAn: vi.fn(), erledigeErinnerung: vi.fn(), quittiereErinnerung: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/erinnerungen']}>
          <Routes><Route path="/einsaetze/:id/erinnerungen" element={<ErinnerungenPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('ErinnerungenPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listet offene Erinnerungen des Einsatzes', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());
  });
});
