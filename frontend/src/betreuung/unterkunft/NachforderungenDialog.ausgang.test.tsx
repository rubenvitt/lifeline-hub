import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUSGANG_UNBEKANNT_TEXT, NetzFehler } from '../../api/client';
import { legeNachforderungAn } from '../../api/nachforderungen';
import type { NeueNachforderung } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import NachforderungenDialog from './NachforderungenDialog';
import type { Posten } from './posten';

/**
 * Unbekannter Ausgang im Dialog „Nachforderungen anlegen“ (LLH-1520, LLH-1526): `apiSend` meldet
 * Zeitlimit und Abbruch als `NetzFehler`, auch wenn der Server schon gespeichert hat. Der Posten
 * bleibt angehakt und geht beim nächsten Versuch mit demselben Schlüssel, auch nach Schließen und
 * erneutem Öffnen; der Server liefert dann die schon gespeicherte Nachforderung zurück.
 */

vi.mock('../../api/nachforderungen', () => ({
  legeNachforderungAn: vi.fn(),
}));

const FELDBETTEN: Posten = {
  schluessel: 'feldbetten',
  art: 'Feldbetten',
  anzahl: 50,
  vorgewaehlt: true,
};

function gesendeteSchluessel(): (string | undefined)[] {
  return vi
    .mocked(legeNachforderungAn)
    .mock.calls.map(([, body]: [number, NeueNachforderung]) => body.client_id);
}

function zeigeDialog(clientIds: Map<string, string>, onSchliessen = vi.fn()) {
  return renderMitProviders(
    <NachforderungenDialog
      einsatzId={1}
      stelleId={8}
      stelleName="Turnhalle Ost"
      posten={[FELDBETTEN]}
      clientIds={clientIds}
      onFertig={vi.fn()}
      onSchliessen={onSchliessen}
    />,
  );
}

describe('NachforderungenDialog bei unbekanntem Ausgang', () => {
  beforeEach(() => vi.mocked(legeNachforderungAn).mockReset());

  it('lässt den Posten angehakt und schickt ihn beim nächsten Lauf mit demselben Schlüssel', async () => {
    vi.mocked(legeNachforderungAn)
      .mockRejectedValueOnce(new NetzFehler())
      .mockResolvedValueOnce({} as never);
    const onSchliessen = vi.fn();
    zeigeDialog(new Map(), onSchliessen);
    const dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    await userEvent.click(within(dialog).getByRole('button', { name: '1 Nachforderung anlegen' }));
    const posten = within(dialog).getByRole('group', { name: 'Posten' });
    expect(await within(posten).findByText(AUSGANG_UNBEKANNT_TEXT)).toBeInTheDocument();
    expect(within(posten).getByRole('checkbox', { name: /Feldbetten/ })).toBeChecked();
    expect(within(dialog).getByText('1 Posten nicht angelegt')).toBeInTheDocument();
    expect(onSchliessen).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: /1 Nachforderung anlegen$/ }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalledTimes(1));
    const [erster, zweiter] = gesendeteSchluessel();
    expect(erster).toMatch(/^[0-9a-f-]{36}$/);
    expect(zweiter).toBe(erster);
  });

  it('behält den Schlüssel über Schließen und erneutes Öffnen; ein angelegter Posten gibt ihn frei', async () => {
    vi.mocked(legeNachforderungAn)
      .mockRejectedValueOnce(new NetzFehler())
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never);
    const clientIds = new Map<string, string>();

    const erst = zeigeDialog(clientIds);
    let dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    await userEvent.click(within(dialog).getByRole('button', { name: '1 Nachforderung anlegen' }));
    expect(await within(dialog).findByText(AUSGANG_UNBEKANNT_TEXT)).toBeInTheDocument();
    erst.unmount();

    // Neu geöffnet ist der Posten wieder vorgewählt und trägt denselben Schlüssel.
    const zweit = zeigeDialog(clientIds);
    dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    await userEvent.click(within(dialog).getByRole('button', { name: '1 Nachforderung anlegen' }));
    await waitFor(() => expect(legeNachforderungAn).toHaveBeenCalledTimes(2));
    zweit.unmount();

    // Nach dem Anlegen ist eine weitere Nachforderung desselben Postens eine neue.
    zeigeDialog(clientIds);
    dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    await userEvent.click(within(dialog).getByRole('button', { name: '1 Nachforderung anlegen' }));
    await waitFor(() => expect(legeNachforderungAn).toHaveBeenCalledTimes(3));

    const [erster, zweiter, dritter] = gesendeteSchluessel();
    expect(zweiter).toBe(erster);
    expect(dritter).not.toBe(erster);
  });
});
