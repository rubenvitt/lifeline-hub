import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { renderMitProviders } from '../test/utils';
import VollzugMeldenModal from './VollzugMeldenModal';

describe('VollzugMeldenModal — Eingabegrenze (LFH-937)', () => {
  it('zählt ab 80 %; über 20 000 Zeichen bleibt der Text stehen und Melden sperrt', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <VollzugMeldenModal offen onAbbrechen={vi.fn()} onBestaetigen={onBestaetigen} />,
    );
    const feld = screen.getByPlaceholderText('Rückmeldung zur Erledigung');
    expect(feld).not.toHaveAttribute('maxlength');
    fireEvent.change(feld, { target: { value: 'v'.repeat(16_000) } });
    expect(screen.getByText('16.000 / 20.000')).toBeInTheDocument();
    fireEvent.change(feld, { target: { value: 'v'.repeat(20_001) } });
    expect(screen.getByText('20.001 / 20.000 · zu lang')).toBeInTheDocument();
    const melden = screen.getByRole('button', { name: 'Vollzug melden' });
    expect(melden).toBeDisabled();
    await userEvent.click(melden);
    expect(onBestaetigen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('v'.repeat(20_001));
  });
});

/**
 * Harness wie am Melde-Weg der Aufträge: `mutateAsync` als Zusage, die Mutation als
 * `speicherung`, Schließen erst im `onSuccess`.
 */
function Harness({
  melde,
  onAbbrechen,
}: {
  melde: (text: string) => Promise<unknown>;
  onAbbrechen?: () => void;
}) {
  const [offen, setOffen] = useState(true);
  const mutation = useMutation({ mutationFn: melde, onSuccess: () => setOffen(false) });
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Wieder öffnen
      </button>
      <VollzugMeldenModal
        offen={offen}
        onAbbrechen={() => {
          onAbbrechen?.();
          setOffen(false);
        }}
        speicherung={mutation}
        onBestaetigen={(text) => mutation.mutateAsync(text)}
      />
    </>
  );
}

describe('VollzugMeldenModal — Speicherfehler im Dialog (LFH-1077)', () => {
  it('sperrt Melden, solange die Rückmeldung leer ist, statt einen Toast zu zeigen', async () => {
    const onBestaetigen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <VollzugMeldenModal offen onAbbrechen={vi.fn()} onBestaetigen={onBestaetigen} />,
    );
    const melden = screen.getByRole('button', { name: 'Vollzug melden' });
    expect(melden).toBeDisabled();
    const feld = screen.getByPlaceholderText('Rückmeldung zur Erledigung');
    await userEvent.type(feld, '   ');
    expect(melden).toBeDisabled();
    await userEvent.click(melden);
    expect(onBestaetigen).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await userEvent.type(feld, 'Deich gehalten');
    expect(melden).toBeEnabled();
  });

  it('behält bei einer Ablehnung den Text und nennt den Grund im Dialog', async () => {
    const melde = vi.fn().mockRejectedValue(new ApiError(422, 'Auftrag ist bereits abgenommen'));
    renderMitProviders(<Harness melde={melde} />);
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung');
    await userEvent.type(feld, 'Deich gehalten');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Auftrag ist bereits abgenommen',
    );
    expect(melde).toHaveBeenCalledWith('Deich gehalten', expect.anything());
    expect(feld).toHaveValue('Deich gehalten');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('das nächste Absenden räumt den Grund; erst der Erfolg leert den Text', async () => {
    let gibFrei: () => void = () => {};
    const melde = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'Auftrag wurde zwischenzeitlich geändert'))
      .mockImplementationOnce(() => new Promise<void>((r) => (gibFrei = r)));
    renderMitProviders(<Harness melde={melde} />);
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung');
    await userEvent.type(feld, 'Deich gehalten');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    // Solange der Server nicht geantwortet hat, steht der Text.
    expect(feld).toHaveValue('Deich gehalten');
    gibFrei();

    // Der Inhalt des schließenden Dialogs ist eingefroren (rc-dialog); geprüft wird beim nächsten
    // Öffnen.
    await waitFor(() => expect(melde).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = await screen.findByRole('dialog', { name: 'Vollzug melden' });
    await waitFor(() =>
      expect(within(wieder).getByPlaceholderText('Rückmeldung zur Erledigung')).toHaveValue(''),
    );
  });

  it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
    const melde = vi.fn().mockRejectedValue(new ApiError(422, 'Auftrag ist bereits abgenommen'));
    renderMitProviders(<Harness melde={melde} />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung'),
      'Deich gehalten',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs
    // ein, und jsdom beendet die Animation nie.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    // Mit Text fragt Abbrechen nach (LLH-2010).
    await userEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = await screen.findByRole('dialog', { name: 'Vollzug melden' });
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });

  /**
   * Der Dialog bleibt bis zur Antwort offen (design.md D3): ein Abbruch während des Meldens nähme
   * der Ablehnung ihren Ort.
   */
  it('Abbrechen, Kreuz, Maske und Escape lassen den Dialog während des Meldens offen', async () => {
    let lehneAb: (e: unknown) => void = () => {};
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <Harness
        melde={() => new Promise((_r, reject) => (lehneAb = reject))}
        onAbbrechen={onAbbrechen}
      />,
    );
    // Auch gesperrte Knöpfe anklicken: der Klick darf nichts bewirken, nicht nur nicht ankommen.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung');
    await user.type(feld, 'Deich gehalten');
    await user.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));

    const abbrechen = within(dialog).getByRole('button', { name: 'Abbrechen' });
    await waitFor(() => expect(abbrechen).toBeDisabled());
    await user.click(abbrechen);
    const kreuz = within(dialog).getByRole('button', { name: /Close|Schliessen|Schließen/i });
    expect(kreuz).toBeDisabled();
    await user.click(kreuz);
    await user.click(document.querySelector<HTMLElement>('.ant-modal-wrap') as HTMLElement);
    await user.click(feld);
    await user.keyboard('{Escape}');
    expect(onAbbrechen).not.toHaveBeenCalled();

    await act(async () => lehneAb(new ApiError(422, 'Auftrag ist bereits abgenommen')));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Auftrag ist bereits abgenommen',
    );
    expect(feld).toHaveValue('Deich gehalten');
    expect(document.querySelector('.ant-zoom-leave')).toBeNull();
  });
});

/**
 * LLH-2010: Eine getippte Vollzugsmeldung geht nicht still verloren (`frontend/AGENTS.md`,
 * „Erfassungs-Norm“): die Maske schließt nie, mit Text fragen Kreuz und Abbrechen nach.
 */
describe('VollzugMeldenModal — Rückfrage vor dem Verwerfen (LLH-2010)', () => {
  const kreuz = () => screen.getByRole('button', { name: /Close|Schliessen|Schließen/i });
  const rueckfrage = () => {
    const d = screen.queryByRole('dialog', { name: 'Eingaben verwerfen?' });
    return d && !d.classList.contains('ant-zoom-leave') ? d : null;
  };

  it('die Maske schließt nicht, auch ohne Text', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(<Harness melde={vi.fn()} onAbbrechen={onAbbrechen} />);
    await screen.findByRole('dialog');
    await userEvent.click(document.querySelector<HTMLElement>('.ant-modal-wrap')!);
    expect(onAbbrechen).not.toHaveBeenCalled();
  });

  it('das Kreuz mit Text fragt nach; „Verwerfen“ schließt', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(<Harness melde={vi.fn()} onAbbrechen={onAbbrechen} />);
    await userEvent.type(screen.getByPlaceholderText('Rückmeldung zur Erledigung'), 'Erledigt');
    await userEvent.click(kreuz());
    expect(
      await screen.findByText('Die Eingaben in „Vollzug melden“ gehen verloren.'),
    ).toBeInTheDocument();
    expect(onAbbrechen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(onAbbrechen).toHaveBeenCalledTimes(1);
  });

  it('das Kreuz ohne Text schließt still', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(<Harness melde={vi.fn()} onAbbrechen={onAbbrechen} />);
    await userEvent.click(kreuz());
    expect(onAbbrechen).toHaveBeenCalledTimes(1);
    expect(rueckfrage()).toBeNull();
  });

  it('nach „Verwerfen“ und erneutem Öffnen ist das Feld leer, und Abbrechen schließt still', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(<Harness melde={vi.fn()} onAbbrechen={onAbbrechen} />);
    await userEvent.type(screen.getByPlaceholderText('Rückmeldung zur Erledigung'), 'Erledigt');
    await userEvent.click(kreuz());
    await userEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Vollzug melden' });
    expect(within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung')).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalledTimes(2);
    expect(rueckfrage()).toBeNull();
  });
});
