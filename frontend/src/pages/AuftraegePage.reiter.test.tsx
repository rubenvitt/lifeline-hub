import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router';
import AuftraegePage from './AuftraegePage';
import { ladeEinsatz } from '../api/einsaetze';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1 } }),
  useAuthOptional: () => ({ benutzer: { id: 1 } }),
}));
vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn() }));
vi.mock('../api/befehle', () => ({
  listeBefehle: vi.fn().mockResolvedValue([]),
  legeBefehlAn: vi.fn(),
  ladeBefehl: vi.fn(),
}));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/auftraege', async () => ({
  ...(await import('../test/auftraegeAttrappe')).auftraegeLeseAttrappe(() => Promise.resolve([])),
  legeAuftragAn: vi.fn(),
  quittiereEmpfaenger: vi.fn(),
  setzeVollzug: vi.fn(),
  nimmAb: vi.fn(),
}));

const EINSATZ = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };

function renderPage(route = '/einsaetze/1/auftraege') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/einsaetze/:id/auftraege" element={<AuftraegePage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('AuftraegePage — Seitenzustände (oxgob5gk D11)', () => {
  beforeEach(() => vi.mocked(ladeEinsatz).mockReset());

  it('lädt mit Skelett statt Spinner', async () => {
    let fertig: (wert: unknown) => void = () => {};
    vi.mocked(ladeEinsatz).mockReturnValue(new Promise((r) => (fertig = r)) as never);
    renderPage();
    expect(screen.getByLabelText('Inhalt wird geladen')).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('.ant-spin')).toBeNull();
    // Auflösen, damit kein offener Abruf den Testabbau aufhält.
    fertig(EINSATZ);
    expect(await screen.findByRole('tab', { name: 'Einzelaufträge' })).toBeInTheDocument();
  });

  it('nennt einen Fehler mit Ursache, und „Erneut abrufen“ fragt neu', async () => {
    vi.mocked(ladeEinsatz).mockRejectedValueOnce(new Error('kaputt'));
    renderPage();
    expect(await screen.findByText('Einsatz nicht gefunden oder kein Zugriff')).toBeInTheDocument();
    vi.mocked(ladeEinsatz).mockResolvedValueOnce(EINSATZ as never);
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(await screen.findByRole('tab', { name: 'Einzelaufträge' })).toBeInTheDocument();
    expect(ladeEinsatz).toHaveBeenCalledTimes(2);
  });
});

describe('AuftraegePage — beide Reiter gleich gebaut (Spec `auftraege-befehle`)', () => {
  beforeEach(() => vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ as never));

  /** Die Filterleiste eines Reiters: Segmentleiste mit zwei Segmenten samt Zahl und Suchfeld. */
  async function pruefeLeiste(leiste: HTMLElement) {
    const gruppe = within(leiste).getAllByRole('radiogroup')[0];
    // Die Zahl steht erst mit der ersten Lieferung da (vorher keine Aussage über die Menge).
    await waitFor(() =>
      expect(
        within(gruppe)
          .getAllByRole('radio')
          .map((s) => s.textContent),
      ).toEqual([expect.stringMatching(/\(\d+\)$/), expect.stringMatching(/\(\d+\)$/)]),
    );
    expect(within(leiste).getByRole('textbox', { name: /durchsuchen/ })).toBeInTheDocument();
  }

  it('Einzelaufträge und Einsatzbefehle tragen dieselbe Leiste; Empfänger und Richtung nur bei Aufträgen', async () => {
    const { container } = renderPage();
    await screen.findByRole('textbox', { name: 'Aufträge durchsuchen' });
    const auftragsLeiste = container.querySelector<HTMLElement>('[data-lfh="auftraege-filter"]')!;
    await pruefeLeiste(auftragsLeiste);
    expect(within(auftragsLeiste).getByText('Empfänger filtern')).toBeInTheDocument();
    expect(within(auftragsLeiste).getByText('Alle Richtungen')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Einsatzbefehle' }));
    await screen.findByRole('textbox', { name: 'Befehle durchsuchen' });
    const befehlsLeiste = container.querySelector<HTMLElement>('[data-lfh="befehle-filter"]')!;
    await pruefeLeiste(befehlsLeiste);
    expect(within(befehlsLeiste).queryByText('Empfänger filtern')).toBeNull();
    expect(within(befehlsLeiste).queryByText('Alle Richtungen')).toBeNull();
  });
});
