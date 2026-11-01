import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AusgangUnbekannt } from '../../api/client';
import { renderMitProviders } from '../../test/utils';
import NachforderungenDialog from './NachforderungenDialog';

/**
 * Unbekannter Ausgang im Dialog „Nachforderungen anlegen“ (LLH-1520): die Anfrage kam an, die
 * Antwort blieb aus. Der Posten wird abgehakt, damit ein zweiter Lauf ihn nicht doppelt anlegt.
 */

vi.mock('../../api/nachforderungen', () => ({
  legeNachforderungAn: vi.fn(() => Promise.reject(new AusgangUnbekannt())),
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
    expect(within(posten).getByText(new AusgangUnbekannt().message)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /0 Nachforderungen anlegen$/ }),
    ).toBeDisabled();
    expect(onFertig).not.toHaveBeenCalled();
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});
