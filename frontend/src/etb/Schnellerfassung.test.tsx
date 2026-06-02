import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbEintragAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import Schnellerfassung from './Schnellerfassung';

function original(): EtbEintragAnzeige {
  return {
    id: 5, lfd_nr: 5, typ: 'meldung', inhalt: 'Original', von: null, an: null,
    meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
    erfasst_lokal_at: null, berichtigt_eintrag_id: null,
  };
}

describe('Schnellerfassung', () => {
  it('sendet typ=meldung mit Inhalt und erfasst_lokal_at', async () => {
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue();
    renderMitProviders(
      <Schnellerfassung
        erfassen={erfassen}
        berichtigungZu={null}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[]}
        einsatz={{ bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), 'Pumpe läuft');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    const arg = erfassen.mock.calls[0][0];
    expect(arg.typ).toBe('meldung');
    expect(arg.inhalt).toBe('Pumpe läuft');
    expect(arg.erfasst_lokal_at).toBeTruthy();
    expect(arg.berichtigt_eintrag_id).toBeUndefined();
  });

  it('sendet im Berichtigungsmodus typ=berichtigung mit berichtigt_eintrag_id', async () => {
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue();
    renderMitProviders(
      <Schnellerfassung
        erfassen={erfassen}
        berichtigungZu={original()}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[]}
        einsatz={{ bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    expect(screen.getByText(/Berichtigung zu #5/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), 'Korrektur');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    const arg = erfassen.mock.calls[0][0];
    expect(arg.typ).toBe('berichtigung');
    expect(arg.berichtigt_eintrag_id).toBe(5);
  });
});
