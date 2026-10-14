import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import MaterialAufteilenModal, { type MaterialAufteilenModalProps } from './MaterialAufteilenModal';

function zeige(p: Partial<MaterialAufteilenModalProps> = {}) {
  const onAufteilen = p.onAufteilen ?? vi.fn().mockResolvedValue(undefined);
  const onSchliessen = p.onSchliessen ?? vi.fn();
  renderMitProviders(
    <MaterialAufteilenModal
      posten={{ id: 10, bezeichnung: 'Wolldecke', menge: 50, ausgegeben: 0 }}
      laeuft={false}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      {...p}
      onAufteilen={onAufteilen}
      onSchliessen={onSchliessen}
    />,
  );
  return { onAufteilen, onSchliessen };
}

describe('MaterialAufteilenModal (LLH-1093, design.md D12)', () => {
  it('zeigt das Ergebnis „Danach 30 + 20“ und teilt mit „Aufteilen“ ab', async () => {
    const { onAufteilen, onSchliessen } = zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke aufteilen');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '20');
    expect(await within(dialog).findByTestId('aufteilen-danach')).toHaveTextContent(
      'Danach 30 + 20',
    );
    const knopf = within(dialog).getByRole('button', { name: 'Aufteilen' });
    expect(knopf.closest('form')).not.toBeNull();
    await userEvent.click(knopf);
    await waitFor(() => expect(onAufteilen).toHaveBeenCalledWith(20));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('die ganze Menge oder mehr lässt sich nicht abteilen', async () => {
    const { onAufteilen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '50');
    expect(within(dialog).queryByTestId('aufteilen-danach')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    expect(await within(dialog).findByText('1 bis 49')).toBeInTheDocument();
    expect(onAufteilen).not.toHaveBeenCalled();
  });

  it('abgeteilt wird nur aus dem Rest; Ausgegebenes bleibt an der Zeile (LLH-1224 D14)', async () => {
    const { onAufteilen } = zeige({
      posten: { id: 10, bezeichnung: 'Wolldecke', menge: 50, ausgegeben: 20 },
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('30 von 50 übrig');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' });
    await userEvent.type(feld, '31');
    expect(within(dialog).queryByTestId('aufteilen-danach')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    expect(await within(dialog).findByText('1 bis 30')).toBeInTheDocument();
    expect(onAufteilen).not.toHaveBeenCalled();

    await userEvent.clear(feld);
    await userEvent.type(feld, '30');
    expect(await within(dialog).findByTestId('aufteilen-danach')).toHaveTextContent(
      'Danach 20 + 30',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    await waitFor(() => expect(onAufteilen).toHaveBeenCalledWith(30));
  });

  it('ohne Menge meldet das Feld den Grund', async () => {
    const { onAufteilen } = zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    expect(await within(dialog).findByText('Menge eintragen')).toBeInTheDocument();
    expect(onAufteilen).not.toHaveBeenCalled();
  });

  it('eine Ablehnung steht im Dialog', async () => {
    zeige({
      speicherung: {
        error: new ApiError(409, 'Material ist nicht mehr im Einsatz'),
        isPending: false,
        reset: () => {},
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/nicht mehr im Einsatz/)).toBeInTheDocument();
  });
});
