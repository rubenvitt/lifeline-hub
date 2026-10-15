import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import MaterialAusgabeModal, { type MaterialAusgabeModalProps } from './MaterialAusgabeModal';

const decke = (ausgegeben: number) => ({ id: 10, bezeichnung: 'Wolldecke', menge: 50, ausgegeben });

function zeige(p: Partial<MaterialAusgabeModalProps> = {}) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  const onSchliessen = p.onSchliessen ?? vi.fn();
  const props: MaterialAusgabeModalProps = {
    posten: decke(0),
    modus: 'ausgeben',
    laeuft: false,
    speicherung: { error: null, isPending: false, reset: () => {} },
    ...p,
    onSpeichern,
    onSchliessen,
  };
  const r = renderMitProviders(<MaterialAusgabeModal {...props} />);
  return { onSpeichern, onSchliessen, props, ...r };
}

describe('MaterialAusgabeModal (LLH-1225 D5)', () => {
  it('ausgeben: zeigt den Rest danach und sendet den Stand beim Öffnen plus n', async () => {
    const { onSpeichern, onSchliessen } = zeige({ posten: decke(10) });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke ausgeben');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '20');
    expect(await within(dialog).findByTestId('ausgabe-danach')).toHaveTextContent(
      'Danach 20 von 50 übrig',
    );
    const knopf = within(dialog).getByRole('button', { name: 'Ausgeben' });
    expect(knopf.closest('form')).not.toBeNull();
    await userEvent.click(knopf);
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(30, 20));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('mehr als der Rest: sendet nicht und nennt die Grenze', async () => {
    const { onSpeichern } = zeige({ posten: decke(20) });
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '40');
    expect(within(dialog).queryByTestId('ausgabe-danach')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausgeben' }));
    expect(await within(dialog).findByText('1 bis 30')).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('die Grenze selbst geht: der ganze Rest', async () => {
    const { onSpeichern } = zeige({ posten: decke(20) });
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '30');
    expect(await within(dialog).findByTestId('ausgabe-danach')).toHaveTextContent(
      'Danach 0 von 50 übrig',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausgeben' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(50, 30));
  });

  it('zurücknehmen: 1 bis zur Ausgabe, sendet den Stand minus n', async () => {
    const { onSpeichern } = zeige({ posten: decke(20), modus: 'zuruecknehmen' });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ausgabe von Wolldecke zurücknehmen');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge zurücknehmen' });
    await userEvent.type(feld, '21');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    expect(await within(dialog).findByText('1 bis 20')).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
    await userEvent.clear(feld);
    await userEvent.type(feld, '5');
    expect(await within(dialog).findByTestId('ausgabe-danach')).toHaveTextContent(
      'Danach 35 von 50 übrig',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(15, 5));
  });

  it('ändert ein anderer Platz die Ausgabe, während der Dialog offen ist, gilt der Stand beim Öffnen', async () => {
    const { onSpeichern, rerender, props } = zeige({ posten: decke(10) });
    const dialog = await screen.findByRole('dialog');
    rerender(<MaterialAusgabeModal {...props} posten={decke(40)} />);
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '20');
    expect(await within(dialog).findByTestId('ausgabe-danach')).toHaveTextContent(
      'Danach 20 von 50 übrig',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausgeben' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(30, 20));
  });

  it('eine Ablehnung steht im Dialog', async () => {
    zeige({
      speicherung: {
        error: new ApiError(422, 'Ausgabe größer als die Menge'),
        isPending: false,
        reset: () => {},
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Ausgabe größer als die Menge/)).toBeInTheDocument();
  });
});
