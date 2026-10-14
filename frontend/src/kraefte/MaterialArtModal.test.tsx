import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import MaterialArtModal, { type MaterialArtModalProps } from './MaterialArtModal';

type Posten = NonNullable<MaterialArtModalProps['posten']>;

const sandsack: Posten = {
  id: 10,
  bezeichnung: 'Sandsack',
  art: 'geraet',
  menge: 1,
  ausgegeben: 0,
  status: 'einsatzbereit',
};

function zeige(posten: Posten) {
  const onSpeichern = vi.fn().mockResolvedValue(undefined);
  const onSchliessen = vi.fn();
  renderMitProviders(
    <MaterialArtModal
      posten={posten}
      laeuft={false}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      onSpeichern={onSpeichern}
      onSchliessen={onSchliessen}
    />,
  );
  return { onSpeichern, onSchliessen };
}

describe('MaterialArtModal (LLH-1224 D10)', () => {
  it('ein Gerät wird Verbrauchsgut mit Menge 40 — Art und Menge in einem PATCH', async () => {
    const { onSpeichern, onSchliessen } = zeige(sandsack);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Art von Sandsack ändern');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await waitFor(() => expect(menge).toBeDisabled());
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Verbrauchsgut' }));
    await waitFor(() => expect(menge).toBeEnabled());
    await userEvent.clear(menge);
    await userEvent.type(menge, '40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith({ art: 'verbrauchsgut', menge: 40 }),
    );
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('zum Gerät steht die Menge fest auf 1 und ist gesperrt, mit Grund', async () => {
    const { onSpeichern } = zeige({ ...sandsack, art: 'verbrauchsgut', menge: 50 });
    const dialog = await screen.findByRole('dialog');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await waitFor(() => expect(menge).toHaveValue('50'));
    expect(menge).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Gerät' }));
    await waitFor(() => expect(menge).toHaveValue('1'));
    expect(menge).toBeDisabled();
    expect(within(dialog).getByText('Ein Gerät steht je Stück im Einsatz')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith({ art: 'geraet', menge: 1 }));
  });

  it('eine größere Menge wechselt die Art nicht still', async () => {
    const { onSpeichern } = zeige({ ...sandsack, art: 'verbrauchsgut', menge: 1 });
    const dialog = await screen.findByRole('dialog');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await waitFor(() => expect(menge).toHaveValue('1'));
    await userEvent.clear(menge);
    await userEvent.type(menge, '5');
    expect(within(dialog).getByRole('radio', { name: 'Verbrauchsgut' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith({ menge: 5 }));
  });

  it('ohne Änderung schließt „Speichern“, ohne zu senden', async () => {
    const { onSpeichern, onSchliessen } = zeige(sandsack);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'Gerät' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('zum Gerät nicht mit Ausgabe: gesperrt mit Grund wie am Server, die Menge nicht darunter', async () => {
    zeige({ ...sandsack, art: 'verbrauchsgut', menge: 50, ausgegeben: 20 });
    const dialog = await screen.findByRole('dialog');
    const geraet = within(dialog).getByRole('radio', { name: 'Gerät' });
    expect(geraet).toHaveAttribute('aria-disabled', 'true');
    expect(geraet).toHaveAccessibleDescription('20 ausgegeben');
    await userEvent.click(geraet);
    expect(geraet).toHaveAttribute('aria-checked', 'false');
    // Unter die Ausgabe sinkt die Menge nicht.
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await waitFor(() => expect(menge).toHaveValue('50'));
    await userEvent.clear(menge);
    await userEvent.type(menge, '10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('mindestens 20')).toBeInTheDocument();
  });

  it('zum Verbrauchsgut nicht mit einem Status, den nur ein Gerät kennt', async () => {
    zeige({ ...sandsack, status: 'verbraucht' });
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('radio', { name: 'Verbrauchsgut' }),
    ).toHaveAccessibleDescription('Status „verbraucht“');
  });
});
