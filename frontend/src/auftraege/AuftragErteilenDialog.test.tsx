import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import AuftragErteilenDialog from './AuftragErteilenDialog';

vi.mock('../fuehrung/useFunktionsVorschlaege', async () => ({
  useFunktionsVorschlaege: (await import('../test/fuehrungsfunktionen')).vorschlaegeFuer,
}));

function rendern(over: Partial<Parameters<typeof AuftragErteilenDialog>[0]> = {}) {
  const props = {
    offen: true,
    onSchliessen: vi.fn(),
    abschnitte: [{ id: 1, name: 'Abschnitt Nord' }],
    einheiten: [{ id: 2, name: 'LZ 1' }],
    einsatzId: 5,
    senden: false,
    onAnlegen: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return { ...renderMitProviders(<AuftragErteilenDialog {...props} />), props };
}

async function ausfuellen(text: string) {
  await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
  await userEvent.type(screen.getByLabelText('Auftrag / Was'), text);
}

describe('AuftragErteilenDialog (Spec `auftraege-befehle`, „Erfassen per Dialog“)', () => {
  it('ist ein Dialog „Auftrag erteilen“ mit dem Formular darin', () => {
    rendern();
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Auftrag erteilen', { selector: '.ant-modal-title' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Auftrag / Was')).toBeInTheDocument();
  });

  it('„Speichern und nächste“ erteilt, hält den Dialog offen und leert das Formular', async () => {
    const { props } = rendern();
    await ausfuellen('Erkunden Nord');
    await userEvent.click(screen.getByRole('button', { name: /Speichern und nächste/ }));
    await waitFor(() => expect(props.onAnlegen).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText('Auftrag / Was')).toHaveValue(''));
    expect(props.onSchliessen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('„Auftrag erteilen“ schließt nach dem Erfolg', async () => {
    const { props } = rendern();
    await ausfuellen('Erkunden Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(props.onSchliessen).toHaveBeenCalledOnce());
  });

  it('abgelehnt bleibt der Dialog offen, die Felder stehen, der Grund steht im Dialog', async () => {
    const fehler = new Error('Empfänger unbekannt');
    const { props } = rendern({
      onAnlegen: vi.fn().mockRejectedValue(fehler),
      speicherung: { isPending: false, error: fehler, reset: vi.fn() },
    });
    await ausfuellen('Erkunden West');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(props.onAnlegen).toHaveBeenCalledOnce());
    expect(props.onSchliessen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Auftrag / Was')).toHaveValue('Erkunden West');
    expect(
      within(screen.getByRole('dialog')).getByText('Auftrag nicht erteilt'),
    ).toBeInTheDocument();
  });

  it('solange gesendet wird, ist jeder Ausweg gesperrt', async () => {
    const { props } = rendern({
      senden: true,
      speicherung: { isPending: true, error: null, reset: vi.fn() },
    });
    await userEvent.keyboard('{Escape}');
    expect(props.onSchliessen).not.toHaveBeenCalled();
  });
});
