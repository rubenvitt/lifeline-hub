import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { globalKeys } from '../api/queryKeys';
import { EinsaetzeBeimGegenueber } from './EinsaetzeBeimGegenueber';
import type { FuehrungAnzeige } from '../api/types';

vi.mock('../api/fuehrung', () => ({
  loadFuehrungFremd: vi.fn(),
  frageFuehrungAn: vi.fn(),
  uebernimmFuehrung: vi.fn(),
}));

import { frageFuehrungAn, loadFuehrungFremd, uebernimmFuehrung } from '../api/fuehrung';

const akte: FuehrungAnzeige = {
  id: 4,
  kennung: 'k-hub/3',
  nummer: 'E2026-0003',
  bezeichnung: 'Stadtfest',
  status: 'aktiv',
  epoche: 1,
  fuehrer_name: 'Hub Nord',
  fuehrer_kennung: 'k-hub',
  fuehrend: false,
  art: 'angelegt',
  anfrage_offen: false,
  verwahrt: false,
  gegenueber: [
    {
      kopplung_id: 1,
      kennung: 'k-hub',
      name: 'Hub Nord',
      richtung: 'meldet_sich',
      art: 'standard',
    },
  ],
  fuehrer_richtung: 'meldet_sich',
  verlauf: [],
};

describe('Einsätze beim Gegenüber (LLH-1491)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listet die Akten mit Führung und öffnet die Bedienung', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockResolvedValue({ ...akte, anfrage_offen: true });
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('E2026-0003 Stadtfest')).toBeInTheDocument();
    expect(screen.getByText('Führung: Hub Nord · Epoche 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    expect(frageFuehrungAn).toHaveBeenCalledWith({ akteId: 4 });
  });

  it('ohne Schalter (404) fehlt der Abschnitt', async () => {
    vi.mocked(loadFuehrungFremd).mockRejectedValue(new Error('404'));
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Einsätze beim Gegenüber')).toBeNull();
  });

  it('fällt die Akte beim Abruf aus der Liste, bleibt der Dialog mit Hinweis stehen (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Nicht mehr unter/)).toBeNull();
    vi.mocked(loadFuehrungFremd).mockResolvedValue([]);
    await client.invalidateQueries({ queryKey: globalKeys.instanzkopplungFuehrung() });
    expect(await screen.findByText('Kein Einsatz beim Gegenüber')).toBeInTheDocument();
    const nochDa = screen.getByRole('dialog');
    expect(
      within(nochDa).getByText(/Nicht mehr unter „Einsätze beim Gegenüber“/),
    ).toBeInTheDocument();
    expect(within(nochDa).getByRole('button', { name: 'Führung anfragen' })).toBeEnabled();
  });

  it('ein neuer Stand aus der Liste erreicht den offenen Dialog (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Führung anfragen' })).toBeInTheDocument();
    vi.mocked(loadFuehrungFremd).mockResolvedValue([{ ...akte, anfrage_offen: true }]);
    await client.invalidateQueries({ queryKey: globalKeys.instanzkopplungFuehrung() });
    expect(await within(dialog).findByText('beim Gegenüber gestellt')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Führung anfragen' })).toBeNull();
  });

  it('nimmt die eigene Aktion die Akte aus der Liste, zeigt der Dialog die Antwort des Servers (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockResolvedValue({ ...akte, anfrage_offen: true });
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    vi.mocked(loadFuehrungFremd).mockResolvedValue([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    expect(await screen.findByText('Kein Einsatz beim Gegenüber')).toBeInTheDocument();
    const nochDa = screen.getByRole('dialog');
    expect(within(nochDa).getByText(/Nicht mehr unter/)).toBeInTheDocument();
    expect(within(nochDa).getByText('beim Gegenüber gestellt')).toBeInTheDocument();
    expect(within(nochDa).queryByRole('button', { name: 'Führung anfragen' })).toBeNull();
  });

  it('nach der eigenen Notübernahme zeigt der Dialog die Führung hier, ohne zweite Notübernahme (LLH-1670)', async () => {
    // Ein Einsatz, der hier als Spiegel liegt: die Notübernahme löscht den Spiegel, die Akte
    // fällt danach aus der Liste.
    const spiegel = { ...akte, einsatz_id: 12 };
    vi.mocked(loadFuehrungFremd).mockResolvedValue([spiegel]);
    vi.mocked(uebernimmFuehrung).mockImplementation(async () => {
      vi.mocked(loadFuehrungFremd).mockResolvedValue([]);
      return {
        ...spiegel,
        fuehrend: true,
        fuehrer_name: 'ELW 1',
        fuehrer_kennung: 'k-elw',
        epoche: 2,
        art: 'notuebernahme',
      };
    });
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Notübernahme …' }));
    const not = await screen.findByRole('dialog', { name: 'Notübernahme gegen Hub Nord' });
    await userEvent.type(within(not).getByLabelText('Grund'), 'Hub weg');
    await userEvent.click(within(not).getByRole('button', { name: 'Führung übernehmen' }));
    expect(await screen.findByText('Kein Einsatz beim Gegenüber')).toBeInTheDocument();
    expect(within(dialog).getByText(/Nicht mehr unter/)).toBeInTheDocument();
    expect(within(dialog).getByText('hier')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Notübernahme …' })).toBeNull();
  });

  it('scheitert der Abruf nach der eigenen Aktion, gilt die Antwort des Servers (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockImplementation(async () => {
      vi.mocked(loadFuehrungFremd).mockRejectedValue(new Error('Server weg'));
      return { ...akte, anfrage_offen: true };
    });
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client: neuerQueryClient() });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    await waitFor(() => expect(loadFuehrungFremd).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText('beim Gegenüber gestellt')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Führung anfragen' })).toBeNull();
  });

  it('solange eine Aktion läuft, lässt sich der Dialog nicht schließen (LLH-1670)', async () => {
    let fertig: (f: FuehrungAnzeige) => void = () => {};
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockReturnValue(new Promise((r) => (fertig = r)));
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client: neuerQueryClient() });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    const kreuz = within(dialog).getByRole('button', { name: 'Close' });
    expect(kreuz).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    // In jsdom endet keine Animation: „geschlossen“ zeigt sich an der beginnenden Schließ-Animation.
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave');
    fertig({ ...akte, anfrage_offen: true });
    await waitFor(() => expect(kreuz).toBeEnabled());
  });
});
