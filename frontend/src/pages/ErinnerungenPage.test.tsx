import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { App as AntApp } from 'antd';
import ErinnerungenPage from './ErinnerungenPage';
import {
  erledigeErinnerung,
  ladeErinnerungKennzahlen,
  listeAbgeschlosseneErinnerungen,
  listeOffeneErinnerungen,
  oeffneErinnerung,
  quittiereErinnerung,
} from '../api/erinnerungen';
import type { Erinnerung } from '../api/types';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Hochwasser',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
}));
vi.mock('../api/erinnerungen', () => {
  const basis = {
    einsatz_id: 1,
    beschreibung: null,
    intervall_minuten: 30,
    empfaenger_funktion: null,
    bezug_typ: null,
    bezug_id: null,
    quelle: 'manuell',
    erstellt_von_id: 1,
    erstellt_at: '2026-06-11 09:00:00',
    quittiert_at: null,
    quittiert_von_id: null,
    vollzug_status: 'offen',
    vollzogen_at: null,
    vollzogen_von_id: null,
  };
  const offen = {
    ...basis,
    id: 7,
    titel: 'Lagemeldung',
    faellig_at: '2026-06-11 10:00:00',
    status: 'offen',
    erledigt_at: null,
    ist_faellig: true,
  };
  const erledigt = {
    ...basis,
    id: 8,
    titel: 'Ablöse erledigt',
    faellig_at: '2026-06-10 10:00:00',
    status: 'erledigt',
    erledigt_at: '2026-06-10 11:00:00',
    ist_faellig: false,
  };
  const quittiert = {
    ...basis,
    id: 9,
    titel: 'Zur Kenntnis',
    faellig_at: '2026-06-10 12:00:00',
    status: 'quittiert',
    erledigt_at: null,
    quittiert_at: '2026-06-10 12:30:00',
    ist_faellig: false,
  };
  return {
    ERINNERUNGEN_SEITE: 100,
    erinnerungCursor: (e: typeof quittiert) => ({
      zeit: e.erledigt_at ?? e.quittiert_at ?? e.erstellt_at,
      id: e.id,
    }),
    // Getrennte Abrufe (LFH-940): offene per Vorgabe, abgeschlossene in Server-Ordnung.
    listeOffeneErinnerungen: vi.fn().mockResolvedValue([offen]),
    listeAbgeschlosseneErinnerungen: vi.fn().mockResolvedValue([quittiert, erledigt]),
    ladeErinnerungKennzahlen: vi.fn().mockResolvedValue({ offen: 1, abgeschlossen: 2 }),
    legeErinnerungAn: vi.fn(),
    erledigeErinnerung: vi.fn(),
    quittiereErinnerung: vi.fn(),
    // Rückweg der beiden Abschluss-Aktionen. Fehlte der Eintrag, wäre der Import zur Laufzeit
    // `undefined`, und der Bruch fiele erst beim Klick auf „Rückgängig" auf.
    oeffneErinnerung: vi.fn(),
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/erinnerungen']}>
          <Routes>
            <Route path="/einsaetze/:id/erinnerungen" element={<ErinnerungenPage />} />
          </Routes>
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

    // Die abgeschlossenen kommen erst mit ihrer Ansicht (LFH-940).
    expect(listeAbgeschlosseneErinnerungen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Abgeschlossen (2)'));
    expect(await screen.findByText('Ablöse erledigt')).toBeInTheDocument();
    expect(screen.getByText('Zur Kenntnis')).toBeInTheDocument();
    expect(screen.queryByText('Lagemeldung')).not.toBeInTheDocument();
    expect(listeOffeneErinnerungen).toHaveBeenCalledWith(1);
    // Eine kurze Seite ist die letzte: kein Nachladen.
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).not.toBeInTheDocument();
  });

  it('lädt ältere abgeschlossene mit dem Cursor der letzten Zeile nach (LFH-940)', async () => {
    const seite = (von: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: 1000 - von - i,
        einsatz_id: 1,
        titel: `Alt ${von + i}`,
        status: 'erledigt',
        faellig_at: '2026-06-10 10:00:00',
        erledigt_at: `2026-06-10 ${String(23 - Math.floor((von + i) / 60)).padStart(2, '0')}:${String(59 - ((von + i) % 60)).padStart(2, '0')}:00`,
        erstellt_at: '2026-06-10 09:00:00',
        quittiert_at: null,
        ist_faellig: false,
      })) as unknown as Erinnerung[];
    vi.mocked(listeAbgeschlosseneErinnerungen)
      .mockResolvedValueOnce(seite(0, 100))
      .mockResolvedValueOnce(seite(100, 3));
    vi.mocked(ladeErinnerungKennzahlen).mockResolvedValueOnce({ offen: 1, abgeschlossen: 103 });
    renderPage();
    await screen.findByText('Lagemeldung');
    fireEvent.click(await screen.findByText('Abgeschlossen (103)'));
    expect(await screen.findByText('Alt 0')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByText('Alt 102')).toBeInTheDocument();
    const letzte = seite(99, 1)[0];
    expect(listeAbgeschlosseneErinnerungen).toHaveBeenLastCalledWith(1, {
      zeit: letzte.erledigt_at,
      id: letzte.id,
    });
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).not.toBeInTheDocument();
  });

  /** Beide Abschluss-Aktionen schalten mit dem ersten Klick; der Rückweg steht im Toast. */
  it('erledigt mit einem Klick und nimmt es über den Rückgängig-Knopf zurück', async () => {
    vi.mocked(erledigeErinnerung).mockResolvedValue(
      {} as Awaited<ReturnType<typeof erledigeErinnerung>>,
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Erledigt/ }));
    await waitFor(() => expect(erledigeErinnerung).toHaveBeenCalledWith(1, 7));

    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(oeffneErinnerung).toHaveBeenCalledWith(1, 7));
  });

  it('quittiert mit einem Klick und bietet denselben Rückweg an', async () => {
    vi.mocked(quittiereErinnerung).mockResolvedValue(
      {} as Awaited<ReturnType<typeof quittiereErinnerung>>,
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Quittieren/ }));
    await waitFor(() => expect(quittiereErinnerung).toHaveBeenCalledWith(1, 7));

    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(oeffneErinnerung).toHaveBeenCalledWith(1, 7));
  });
});
