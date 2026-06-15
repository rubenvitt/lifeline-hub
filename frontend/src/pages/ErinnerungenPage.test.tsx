import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App as AntApp } from 'antd';
import ErinnerungenPage from './ErinnerungenPage';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));
vi.mock('../api/erinnerungen', () => {
  const basis = {
    einsatz_id: 1, beschreibung: null, intervall_minuten: 30, empfaenger_funktion: null,
    bezug_typ: null, bezug_id: null, quelle: 'manuell', erstellt_von_id: 1,
    erstellt_at: '2026-06-11 09:00:00', quittiert_at: null, quittiert_von_id: null,
    vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
  };
  return {
    listeErinnerungen: vi.fn().mockResolvedValue([
      { ...basis, id: 7, titel: 'Lagemeldung', faellig_at: '2026-06-11 10:00:00',
        status: 'offen', erledigt_at: null, ist_faellig: true },
      { ...basis, id: 8, titel: 'Ablöse erledigt', faellig_at: '2026-06-10 10:00:00',
        status: 'erledigt', erledigt_at: '2026-06-10 11:00:00', ist_faellig: false },
      { ...basis, id: 9, titel: 'Zur Kenntnis', faellig_at: '2026-06-10 12:00:00',
        status: 'quittiert', erledigt_at: null, quittiert_at: '2026-06-10 12:30:00', ist_faellig: false },
    ]),
    legeErinnerungAn: vi.fn(), erledigeErinnerung: vi.fn(), quittiereErinnerung: vi.fn(),
  };
});

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

  it('zeigt standardmäßig die offenen Erinnerungen, abgeschlossene erst nach Umschalten', async () => {
    renderPage();
    // Offen-Ansicht (Default): nur die offene Erinnerung.
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());
    expect(screen.queryByText('Ablöse erledigt')).not.toBeInTheDocument();
    expect(screen.queryByText('Zur Kenntnis')).not.toBeInTheDocument();

    // Segmented zeigt die Counts: 1 offen, 2 abgeschlossen (erledigt + quittiert).
    expect(screen.getByText('Offen (1)')).toBeInTheDocument();
    expect(screen.getByText('Abgeschlossen (2)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Abgeschlossen (2)'));
    expect(await screen.findByText('Ablöse erledigt')).toBeInTheDocument();
    expect(screen.getByText('Zur Kenntnis')).toBeInTheDocument();
    expect(screen.queryByText('Lagemeldung')).not.toBeInTheDocument();
  });
});
