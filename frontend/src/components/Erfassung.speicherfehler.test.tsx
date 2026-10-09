import { useMutation } from '@tanstack/react-query';
import { Button, Form, Input } from 'antd';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders } from '../test/utils';
import { ErfassungsFormular, ErfassungsModal } from './Erfassung';

/**
 * Speicherfehler im Dialog (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): die Hülle
 * zeigt den Grund der Ablehnung im Dialog, bis zum nächsten Absenden, und räumt ihn beim Öffnen
 * und Abbrechen. Kein Toast.
 */

interface Werte {
  name: string;
}

function DialogHarness({
  speichern,
  onAbbrechen,
}: {
  speichern: (w: Werte) => Promise<unknown>;
  onAbbrechen?: () => void;
}) {
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
        onAbbrechen={() => {
          onAbbrechen?.();
          setOffen(false);
        }}
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

function InlineHarness({
  speichern,
  onAbbrechen,
}: {
  speichern: (w: Werte) => Promise<unknown>;
  onAbbrechen?: () => void;
}) {
  const [form] = Form.useForm<Werte>();
  const [sichtbar, setSichtbar] = useState(true);
  const mutation = useMutation({ mutationFn: speichern });
  return (
    <CommandPaletteProvider>
      <Button onClick={() => setSichtbar((s) => !s)}>Umschalten</Button>
      {sichtbar && (
        <ErfassungsFormular<Werte>
          form={form}
          onErfassen={(w) => mutation.mutateAsync(w)}
          onFertig={() => {}}
          onAbbrechen={onAbbrechen}
          speicherung={mutation}
          speicherFehlerFallback="Download fehlgeschlagen"
          erfassenText="Speichern"
        >
          <Form.Item label="Name" name="name">
            <Input />
          </Form.Item>
        </ErfassungsFormular>
      )}
    </CommandPaletteProvider>
  );
}

/**
 * Abbrechen während des Sendens (design.md D3): der Dialog bleibt bis zur Antwort offen, sonst
 * hätte die Ablehnung keinen Ort mehr. Alle vier Auswege sind gesperrt, solange die Mutation läuft.
 */
describe('ErfassungsModal — Abbrechen während des Sendens (LFH-1077)', () => {
  it('Knopf, Kreuz, Maske und Escape lassen den Dialog offen; die Ablehnung steht danach darin', async () => {
    // Auch gesperrte Knöpfe anklicken: der Klick darf nichts bewirken, nicht nur nicht ankommen.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    let lehneAb: (e: unknown) => void = () => {};
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <DialogHarness
        speichern={() => new Promise((_r, reject) => (lehneAb = reject))}
        onAbbrechen={onAbbrechen}
      />,
    );
    const dialog = await oeffneUndSpeichere(user);
    const abbrechen = within(dialog).getByRole('button', { name: 'Abbrechen' });
    await waitFor(() => expect(abbrechen).toBeDisabled());

    await user.click(abbrechen);
    const kreuz = screen.getByRole('button', { name: /Close|Schliessen|Schließen/i });
    expect(kreuz).toBeDisabled();
    await user.click(kreuz);
    await user.click(document.querySelector<HTMLElement>('.ant-modal-wrap') as HTMLElement);
    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Escape' });
    expect(onAbbrechen).not.toHaveBeenCalled();

    await act(async () => lehneAb(new ApiError(422, 'Kennzeichen schon vergeben')));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Kennzeichen schon vergeben',
    );
    expect(within(dialog).getByLabelText('Name')).toHaveValue('HLF 1');
    expect(document.querySelector('.ant-zoom-leave')).toBeNull();
    expect(abbrechen).toBeEnabled();
  });
});

describe('ErfassungsFormular — Speicherfehler beim Einhängen und ohne Servermeldung (LFH-1077)', () => {
  it('räumt beim erneuten Einhängen den Grund, den niemand per Abbrechen geräumt hat', async () => {
    const user = userEvent.setup();
    renderMitProviders(
      <InlineHarness speichern={vi.fn().mockRejectedValue(new ApiError(422, 'Abgelehnt'))} />,
    );
    await user.type(screen.getByLabelText('Name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Abgelehnt');

    await user.click(screen.getByRole('button', { name: 'Umschalten' }));
    await user.click(screen.getByRole('button', { name: 'Umschalten' }));
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('nennt bei einem Fehler ohne Servermeldung den Rückfalltext des Aufrufers', async () => {
    const user = userEvent.setup();
    renderMitProviders(
      <InlineHarness speichern={vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))} />,
    );
    await user.type(screen.getByLabelText('Name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Download fehlgeschlagen');
  });
});

describe('ErfassungsFormular — Abbrechen während des Sendens (LFH-1077)', () => {
  it('Knopf und Escape leeren nichts, solange die Mutation läuft; die Ablehnung steht danach da', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    let lehneAb: (e: unknown) => void = () => {};
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <InlineHarness
        speichern={() => new Promise((_r, reject) => (lehneAb = reject))}
        onAbbrechen={onAbbrechen}
      />,
    );
    await user.type(screen.getByLabelText('Name'), 'HLF 1');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    const abbrechen = screen.getByRole('button', { name: 'Abbrechen' });
    await waitFor(() => expect(abbrechen).toBeDisabled());

    await user.click(abbrechen);
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(onAbbrechen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('HLF 1');

    await act(async () => lehneAb(new ApiError(422, 'Abgelehnt')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Abgelehnt');
    expect(screen.getByLabelText('Name')).toHaveValue('HLF 1');
  });
});
