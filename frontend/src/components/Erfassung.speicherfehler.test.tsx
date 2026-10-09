import { useMutation } from '@tanstack/react-query';
import { Button, Form, Input } from 'antd';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders } from '../test/utils';
import { ErfassungsModal } from './Erfassung';

/**
 * Speicherfehler im Dialog (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): die Hülle
 * zeigt den Grund der Ablehnung im Dialog, bis zum nächsten Absenden, und räumt ihn beim Öffnen
 * und Abbrechen. Kein Toast.
 */

interface Werte {
  name: string;
}

function DialogHarness({ speichern }: { speichern: (w: Werte) => Promise<unknown> }) {
  const [form] = Form.useForm<Werte>();
  const [offen, setOffen] = useState(false);
  const mutation = useMutation({ mutationFn: speichern });
  return (
    <CommandPaletteProvider>
      <Button onClick={() => setOffen(true)}>Öffnen</Button>
      <ErfassungsModal<Werte>
        offen={offen}
        titel="Fahrzeug bearbeiten"
        form={form}
        onErfassen={(w) => mutation.mutateAsync(w)}
        onFertig={() => setOffen(false)}
        onAbbrechen={() => setOffen(false)}
        laeuft={mutation.isPending}
        speicherung={mutation}
        erfassenText="Speichern"
      >
        <Form.Item label="Name" name="name">
          <Input />
        </Form.Item>
      </ErfassungsModal>
    </CommandPaletteProvider>
  );
}

async function oeffneUndSpeichere(user: ReturnType<typeof userEvent.setup>, name = 'HLF 1') {
  await user.click(screen.getByRole('button', { name: 'Öffnen' }));
  const dialog = await screen.findByRole('dialog');
  const feld = within(dialog).getByLabelText('Name');
  await user.clear(feld);
  await user.type(feld, name);
  await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
  return dialog;
}

describe('ErfassungsModal — Speicherfehler im Dialog (LFH-1077)', () => {
  it('zeigt die Ablehnung im offenen Dialog, behält den Wortlaut und zeigt keinen Toast', async () => {
    const user = userEvent.setup();
    renderMitProviders(
      <DialogHarness
        speichern={vi.fn().mockRejectedValue(new ApiError(422, 'Kennzeichen schon vergeben'))}
      />,
    );
    const dialog = await oeffneUndSpeichere(user);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Kennzeichen schon vergeben',
    );
    expect(within(dialog).getByLabelText('Name')).toHaveValue('HLF 1');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('räumt den Grund beim nächsten Absenden', async () => {
    const user = userEvent.setup();
    let antworte: (wert: unknown) => void = () => {};
    const speichern = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'Kennzeichen schon vergeben'))
      .mockImplementationOnce(() => new Promise((r) => (antworte = r)));
    renderMitProviders(<DialogHarness speichern={speichern} />);
    const dialog = await oeffneUndSpeichere(user);
    await within(dialog).findByRole('alert');

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    antworte(undefined);
  });

  it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
    const user = userEvent.setup();
    renderMitProviders(
      <DialogHarness
        speichern={vi.fn().mockRejectedValue(new ApiError(422, 'Kennzeichen schon vergeben'))}
      />,
    );
    const dialog = await oeffneUndSpeichere(user);
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs ein,
    // und jsdom beendet die Animation nie.
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    const wieder = await screen.findByRole('dialog');
    expect(within(wieder).getByLabelText('Name')).toHaveValue('');
    expect(within(wieder).queryByRole('alert')).toBeNull();
  });
});
