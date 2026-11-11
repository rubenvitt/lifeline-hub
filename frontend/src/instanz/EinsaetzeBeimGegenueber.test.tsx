import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { EinsaetzeBeimGegenueber } from './EinsaetzeBeimGegenueber';
import type { FuehrungAnzeige } from '../api/types';

vi.mock('../api/fuehrung', () => ({
  loadFuehrungFremd: vi.fn(),
  frageFuehrungAn: vi.fn(),
  uebernimmFuehrung: vi.fn(),
}));

import { frageFuehrungAn, loadFuehrungFremd } from '../api/fuehrung';

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
  gegenueber: [{ kopplung_id: 1, kennung: 'k-hub', name: 'Hub Nord', richtung: 'meldet_sich' }],
  fuehrer_richtung: 'meldet_sich',
  verlauf: [],
};

describe('Einsätze beim Gegenüber (LLH-1491)', () => {
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
});
