import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import MaterialHierherModal, { type MaterialHierherModalProps } from './MaterialHierherModal';

const DECKE = {
  id: 10,
  bezeichnung: 'Wolldecke',
  art: 'verbrauchsgut' as const,
  menge: 50,
  ausgegeben: 0,
};

function zeige(p: Partial<MaterialHierherModalProps> = {}) {
  const onHolen = p.onHolen ?? vi.fn().mockResolvedValue(undefined);
  const onSchliessen = p.onSchliessen ?? vi.fn();
  renderMitProviders(
    <MaterialHierherModal
      posten={DECKE}
      bisherText="Staffel A"
      laeuft={false}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      {...p}
      onHolen={onHolen}
      onSchliessen={onSchliessen}
    />,
  );
  return { onHolen, onSchliessen };
}

/** „Teilmenge hierher“ als Mengenfrage beim Zuordnen (t1hvaqzu, design.md D6). */
describe('MaterialHierherModal (t1hvaqzu, design.md D6)', () => {
  it('steht auf der ganzen Menge; Bestätigen holt alles', async () => {
    const { onHolen, onSchliessen } = zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke hierher');
    expect(within(dialog).getByRole('spinbutton', { name: 'Menge hierher' })).toHaveValue('50');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hierher' }));
    await waitFor(() => expect(onHolen).toHaveBeenCalledWith(50));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('eine Teilmenge nennt, was wo bleibt', async () => {
    const { onHolen } = zeige();
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge hierher' });
    await userEvent.clear(feld);
    await userEvent.type(feld, '20');
    expect(await within(dialog).findByTestId('hierher-danach')).toHaveTextContent(
      'Danach hier 20, Staffel A 30',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hierher' }));
    await waitFor(() => expect(onHolen).toHaveBeenCalledWith(20));
  });

  it('Grenzen: 1 bis zum Rest oder alles (LLH-1224 D14)', async () => {
    const { onHolen } = zeige({ posten: { ...DECKE, ausgegeben: 20 } });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('30 von 50 übrig');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge hierher' });
    await userEvent.clear(feld);
    await userEvent.type(feld, '31');
    expect(within(dialog).queryByTestId('hierher-danach')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hierher' }));
    expect(await within(dialog).findByText('1 bis 30 oder alle 50')).toBeInTheDocument();
    expect(onHolen).not.toHaveBeenCalled();
  });

  it('eine Ablehnung steht im Dialog', async () => {
    zeige({
      speicherung: {
        error: new ApiError(422, 'UHS ist aufgelöst'),
        isPending: false,
        reset: () => {},
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/UHS ist aufgelöst/)).toBeInTheDocument();
  });
});
