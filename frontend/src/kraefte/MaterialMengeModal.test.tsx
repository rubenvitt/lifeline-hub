import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import MaterialMengeModal, { type MaterialMengeModalProps } from './MaterialMengeModal';

function zeige(p: Partial<MaterialMengeModalProps> = {}) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  const onSchliessen = p.onSchliessen ?? vi.fn();
  renderMitProviders(
    <MaterialMengeModal
      posten={{ id: 10, bezeichnung: 'Wolldecke', menge: 50, ausgegeben: 0 }}
      laeuft={false}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      {...p}
      onSpeichern={onSpeichern}
      onSchliessen={onSchliessen}
    />,
  );
  return { onSpeichern, onSchliessen };
}

describe('MaterialMengeModal (LLH-1225 D5)', () => {
  it('steht mit der Menge da und sendet die neue mit „Speichern“', async () => {
    const { onSpeichern, onSchliessen } = zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Menge von Wolldecke ändern');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await waitFor(() => expect(feld).toHaveValue('50'));
    await userEvent.clear(feld);
    await userEvent.type(feld, '80');
    const knopf = within(dialog).getByRole('button', { name: 'Speichern' });
    expect(knopf.closest('form')).not.toBeNull();
    await userEvent.click(knopf);
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(80));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('nicht unter die Ausgabe: nennt die Grenze und sendet nicht', async () => {
    const { onSpeichern } = zeige({
      posten: { id: 10, bezeichnung: 'Wolldecke', menge: 50, ausgegeben: 20 },
    });
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(feld);
    await userEvent.type(feld, '19');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('mindestens 20')).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
    await userEvent.clear(feld);
    await userEvent.type(feld, '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(20));
  });

  it('unverändert sendet nichts und schließt', async () => {
    const { onSpeichern, onSchliessen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('spinbutton', { name: 'Menge' })).toHaveValue('50'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('eine Ablehnung steht im Dialog', async () => {
    zeige({
      speicherung: {
        error: new ApiError(422, 'Menge kleiner als die Ausgabe'),
        isPending: false,
        reset: () => {},
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Menge kleiner als die Ausgabe/)).toBeInTheDocument();
  });
});
