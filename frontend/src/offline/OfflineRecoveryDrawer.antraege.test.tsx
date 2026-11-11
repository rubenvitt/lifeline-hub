import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { loadAbgelehnteAntraege, verwerfeAbgelehntenAntrag } from '../api/spiegelAntraege';
import type { AbgelehnterAntragAnzeige } from '../api/types';
import { AbgelehnteAntraegeQuelle } from '../einsatz/spiegel/abgelehnteAntraege';
import LiveStatusBanner from '../live/LiveStatusBanner';
import { neuerQueryClient } from '../test/utils';
import { queueLeerenFuerTests } from './queue';
import OfflineRecoveryDrawer from './OfflineRecoveryDrawer';

// Abgelehnte Anträge nach der Verwahrung (LLH-1648): der Einsatz ist kein Spiegel mehr, das
// Hinweisband fehlt; Betriebszeile und Drawer tragen die Anträge einsatzübergreifend.
vi.mock('../api/spiegelAntraege', async (original) => ({
  ...(await original<typeof import('../api/spiegelAntraege')>()),
  loadAbgelehnteAntraege: vi.fn(),
  verwerfeAbgelehntenAntrag: vi.fn(),
}));

// Länger als der 80-Zeichen-Auszug des Bands.
const INHALT = `Patient übergeben ${'und versorgt '.repeat(8)}`.trim();

const ANTRAG: AbgelehnterAntragAnzeige = {
  id: 4,
  einsatz_id: 7,
  einsatznummer: 'E-2026-0042',
  stichwort: 'RD 1',
  art: 'etb',
  grund: 'Einsatz abgeschlossen.',
  erfasst_at: '2026-11-10 13:30:00',
  frist_bis: '2026-12-11 08:00:00',
  daten: { von: 'UHS', inhalt: INHALT } as never,
};

let client: QueryClient;

beforeEach(() => {
  client = neuerQueryClient();
  vi.mocked(loadAbgelehnteAntraege).mockReset();
  vi.mocked(verwerfeAbgelehntenAntrag).mockReset();
});

afterEach(async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  await queueLeerenFuerTests();
  vi.restoreAllMocks();
});

function renderBanner(geraet = false) {
  return render(
    <QueryClientProvider client={client}>
      <App>
        <LiveStatusBanner benutzerId={11} geraet={geraet} />
      </App>
    </QueryClientProvider>,
  );
}

/** Der Drawer liest den Cache; geladen wird er wie in der Betriebszeile über die Quelle. */
function renderDrawer(einsatzId?: number) {
  return render(
    <QueryClientProvider client={client}>
      <App>
        <AbgelehnteAntraegeQuelle benutzerId={11} />
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} einsatzId={einsatzId} />
      </App>
    </QueryClientProvider>,
  );
}

const karte = async () =>
  (await screen.findByText('Abgelehnter Antrag: ETB-Eintrag')).closest<HTMLElement>(
    '[data-lfh="abgelehnter-antrag"]',
  )!;

describe('Betriebszeile: abgelehnte Anträge ohne Spiegel', () => {
  it('zählt sie und öffnet den Drawer mit der Karte', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValue([ANTRAG]);
    renderBanner();

    const knopf = await screen.findByRole('button', { name: 'Anträge abgelehnt (1 Antrag)' });
    expect(loadAbgelehnteAntraege).toHaveBeenCalledTimes(1);
    await userEvent.click(knopf);

    const k = await karte();
    expect(within(k).getByText('E-2026-0042 · RD 1')).toBeInTheDocument();
    expect(within(k).getByText('Einsatz abgeschlossen.')).toBeInTheDocument();
    // Ungekürzt, nicht der 80-Zeichen-Auszug des Bands.
    expect(within(k).getByText(`UHS: ${INHALT}`)).toBeInTheDocument();
    // Bis wann er bleibt, in der Zeitdarstellung der Person.
    expect(within(k).getByText(/^bis \S+/)).toBeInTheDocument();
    // „Neu erfassen“ entfällt: der Einsatz ist abgeschlossen.
    expect(within(k).queryByRole('button', { name: 'Neu erfassen' })).not.toBeInTheDocument();
  });

  it('zeigt ohne abgelehnte Anträge nichts', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValue([]);
    const { container } = renderBanner();
    await waitFor(() => expect(loadAbgelehnteAntraege).toHaveBeenCalled());
    expect(container.querySelector('.ant-alert')).not.toBeInTheDocument();
  });

  it('fragt in einer Gerätesitzung nicht', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValue([ANTRAG]);
    renderBanner(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(loadAbgelehnteAntraege).not.toHaveBeenCalled();
    expect(screen.queryByText('Anträge abgelehnt')).not.toBeInTheDocument();
  });
});

describe('Wiederherstellungs-Drawer: abgelehnter Antrag', () => {
  it('kopiert Art, Einsatz, Zeit, Daten und Grund', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValueOnce([ANTRAG]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderDrawer();

    await userEvent.click(within(await karte()).getByRole('button', { name: 'Kopieren' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text.split('\n')).toEqual([
      'Antrag: ETB-Eintrag',
      'Einsatz: E-2026-0042 · RD 1',
      expect.stringMatching(/^Erfasst: \S+/),
      `Daten: UHS: ${INHALT}`,
      'Grund: Einsatz abgeschlossen.',
    ]);
    expect(await screen.findByText('Antrag kopiert')).toBeInTheDocument();
  });

  it('nennt an der Karte, wenn die Zwischenablage ablehnt', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValueOnce([ANTRAG]);
    const writeText = vi.fn().mockRejectedValue(new DOMException('verweigert', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderDrawer();

    const k = await karte();
    await userEvent.click(within(k).getByRole('button', { name: 'Kopieren' }));

    expect(await within(k).findByText(/Nicht kopiert/)).toBeInTheDocument();
  });

  it('verwirft erst nach Rückfrage und lädt die Liste neu', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValueOnce([ANTRAG]);
    vi.mocked(verwerfeAbgelehntenAntrag).mockResolvedValue(undefined);
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValue([]);
    renderDrawer();

    await userEvent.click(within(await karte()).getByRole('button', { name: 'Verwerfen' }));
    expect(verwerfeAbgelehntenAntrag).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Endgültig verwerfen' }));

    await waitFor(() => expect(verwerfeAbgelehntenAntrag).toHaveBeenCalledWith(4));
    await waitFor(() =>
      expect(screen.queryByText('Abgelehnter Antrag: ETB-Eintrag')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Antrag verworfen')).toBeInTheDocument();
    expect(screen.getByText('Keine wiederherzustellenden Offline-Aktionen')).toBeInTheDocument();
  });

  it('nennt den Grund, wenn der Antrag schon weg ist', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValueOnce([ANTRAG]);
    vi.mocked(verwerfeAbgelehntenAntrag).mockRejectedValue(new ApiError(404, 'Nicht gefunden'));
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValue([]);
    renderDrawer();

    await userEvent.click(within(await karte()).getByRole('button', { name: 'Verwerfen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Endgültig verwerfen' }));

    expect(await screen.findByText(/Nicht gefunden/)).toBeInTheDocument();
    await waitFor(() => expect(loadAbgelehnteAntraege).toHaveBeenCalled());
  });

  it('zeigt am Einsatz nur dessen Anträge', async () => {
    vi.mocked(loadAbgelehnteAntraege).mockResolvedValueOnce([ANTRAG]);
    renderDrawer(8);
    expect(
      await screen.findByText('Keine wiederherzustellenden Offline-Aktionen'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Abgelehnter Antrag: ETB-Eintrag')).not.toBeInTheDocument();
  });
});
