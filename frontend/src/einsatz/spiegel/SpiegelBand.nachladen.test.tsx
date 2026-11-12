import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EinsatzSpiegelAnzeige } from '../../api/types';
import { einsatzFixture } from '../../test/fixtures';
import { renderMitProviders } from '../../test/utils';
import SpiegelBand from './SpiegelBand';

// Der Chunk der Liste lädt nicht (erste Sitzung ohne Netz): Das Nachladen scheitert.
vi.mock('./BruchstelleListe', () => {
  throw new Error('Chunk nicht geladen');
});

const spiegel: EinsatzSpiegelAnzeige = {
  gegenstelle: 'ELW 1 DRK Nord',
  letzter_abgleich_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  beendet: false,
  antraege_ausstehend: 0,
  antraege_abgelehnt: 0,
  bruchstelle: 2,
};

describe('SpiegelBand: Liste der Bruchstelle lädt nicht nach (LLH-1646)', () => {
  it('zeigt nur im Band einen Hinweis, das Band bleibt bedienbar', async () => {
    const user = userEvent.setup();
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture({ spiegel })} />);
    const knopf = screen.getByRole('button', { name: /Nicht übernommen/ });
    await user.click(knopf);
    expect(await screen.findByText(/Liste nicht geladen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
    await user.click(knopf);
    expect(screen.queryByText(/Liste nicht geladen/)).toBeNull();
  });
});
