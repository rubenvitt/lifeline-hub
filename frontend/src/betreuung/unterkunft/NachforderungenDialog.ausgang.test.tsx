import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, AUSGANG_UNBEKANNT_TEXT, NetzFehler } from '../../api/client';
import { legeNachforderungAn } from '../../api/nachforderungen';
import { renderMitProviders } from '../../test/utils';
import NachforderungenDialog from './NachforderungenDialog';

/**
 * Unbekannter Ausgang im Dialog „Nachforderungen anlegen“ (LLH-1520): `apiSend` meldet Zeitlimit
 * und Abbruch als `NetzFehler`, auch wenn der Server schon gespeichert hat. Der Posten wird abgehakt, damit ein zweiter Lauf ihn nicht doppelt anlegt.
 */

vi.mock('../../api/nachforderungen', () => ({
  legeNachforderungAn: vi.fn(() => Promise.reject(new NetzFehler())),
}));

describe('NachforderungenDialog bei unbekanntem Ausgang', () => {
  it('hakt den Posten ab und nennt den Prüfhinweis', async () => {
    const onFertig = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <NachforderungenDialog
        einsatzId={1}
        stelleId={8}
        stelleName="Turnhalle Ost"
        posten={[{ schluessel: 'feldbetten', art: 'Feldbetten', anzahl: 50, vorgewaehlt: true }]}
        onFertig={onFertig}
        onSchliessen={onSchliessen}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    await userEvent.click(within(dialog).getByRole('button', { name: '1 Nachforderung anlegen' }));
    const posten = within(dialog).getByRole('group', { name: 'Posten' });
    await waitFor(() =>
      expect(within(posten).getByRole('checkbox', { name: /Feldbetten/ })).not.toBeChecked(),
    );
    expect(within(posten).getByText(AUSGANG_UNBEKANNT_TEXT)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /0 Nachforderungen anlegen$/ }),
    ).toBeDisabled();
    expect(onFertig).not.toHaveBeenCalled();
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(within(dialog).getByText('1 Posten ungeklärt')).toBeInTheDocument();
    expect(within(dialog).queryByText(/nicht angelegt/)).not.toBeInTheDocument();
  });

  it('bleibt offen, solange ein Ausgang ungeklärt ist, auch wenn der nächste Lauf klappt', async () => {
    vi.mocked(legeNachforderungAn)
      .mockRejectedValueOnce(new NetzFehler())
      .mockRejectedValueOnce(new ApiError(422, 'Lager leer'))
      .mockResolvedValueOnce({} as never);
    const onFertig = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <NachforderungenDialog
        einsatzId={1}
        stelleId={8}
        stelleName="Turnhalle Ost"
        posten={[
          { schluessel: 'feldbetten', art: 'Feldbetten', anzahl: 50, vorgewaehlt: true },
          { schluessel: 'decken', art: 'Decken', anzahl: 100, vorgewaehlt: true },
        ]}
        onFertig={onFertig}
        onSchliessen={onSchliessen}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: '2 Nachforderungen anlegen' }),
    );
    expect(await within(dialog).findByText('1 Posten ungeklärt')).toBeInTheDocument();
    expect(within(dialog).getByText('1 Posten nicht angelegt')).toBeInTheDocument();

    // Zweiter Lauf: nur Decken, klappt. Der ungeklärte Posten hält den Dialog offen.
    await userEvent.click(within(dialog).getByRole('button', { name: /1 Nachforderung anlegen$/ }));
    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
    expect(onFertig).toHaveBeenLastCalledWith({ angelegt: ['Decken'], gescheitert: [] }, true);
    expect(onSchliessen).not.toHaveBeenCalled();
    const posten = within(dialog).getByRole('group', { name: 'Posten' });
    expect(within(posten).getByText(AUSGANG_UNBEKANNT_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByText('1 Posten ungeklärt')).toBeInTheDocument();
    expect(within(dialog).queryByText(/nicht angelegt/)).not.toBeInTheDocument();
  });
});
