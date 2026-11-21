import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client';
import type { Meldung } from '../api/types';
import { renderMitProviders } from '../test/utils';
import LagerelevantModal, { type LagerelevantDaten } from './LagerelevantModal';

/**
 * LLH-2010: „In die Lage übernehmen“ läuft über die Erfassungshülle (`frontend/AGENTS.md`,
 * „Erfassungs-Norm“). Die Maske schließt nie; der vorbelegte Lage-Text allein fragt nicht, ein
 * geänderter schon.
 */
function Harness({
  uebergib,
  onAbbrechen,
}: {
  uebergib: (d: LagerelevantDaten) => Promise<unknown>;
  onAbbrechen?: () => void;
}) {
  const [offen, setOffen] = useState(true);
  const mutation = useMutation({ mutationFn: uebergib, onSuccess: () => setOffen(false) });
  return (
    <LagerelevantModal
      offen={offen}
      meldung={{ id: 3, inhalt: 'Deich bei km 3 durchweicht' } as Meldung}
      senden={mutation.isPending}
      einsatzId={1}
      onAbbrechen={() => {
        onAbbrechen?.();
        setOffen(false);
      }}
      onUebergeben={(d) => mutation.mutateAsync(d)}
      speicherung={mutation}
    />
  );
}

const kreuz = () => screen.getByRole('button', { name: /Close|Schliessen|Schließen/i });
const rueckfrage = () => {
  const d = screen.queryByRole('dialog', { name: 'Eingaben verwerfen?' });
  return d && !d.classList.contains('ant-zoom-leave') ? d : null;
};

describe('LagerelevantModal — Rückfrage vor dem Verwerfen (LLH-2010)', () => {
  it('der vorbelegte Lage-Text allein: das Kreuz schließt still', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(<Harness uebergib={vi.fn()} onAbbrechen={onAbbrechen} />);
    expect(await screen.findByLabelText('Lage-Text')).toHaveValue('Deich bei km 3 durchweicht');
    await userEvent.click(kreuz());
    expect(onAbbrechen).toHaveBeenCalledTimes(1);
    expect(rueckfrage()).toBeNull();
  });

  it('ein geänderter Lage-Text: das Kreuz fragt nach', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(<Harness uebergib={vi.fn()} onAbbrechen={onAbbrechen} />);
    await userEvent.type(await screen.findByLabelText('Lage-Text'), ', Sandsäcke nötig');
    await userEvent.click(kreuz());
    expect(
      await screen.findByText('Die Eingaben in „In die Lage übernehmen“ gehen verloren.'),
    ).toBeInTheDocument();
    expect(onAbbrechen).not.toHaveBeenCalled();
  });

  it('die Maske schließt nicht', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(<Harness uebergib={vi.fn()} onAbbrechen={onAbbrechen} />);
    await screen.findByLabelText('Lage-Text');
    await userEvent.click(document.querySelector<HTMLElement>('.ant-modal-wrap')!);
    expect(onAbbrechen).not.toHaveBeenCalled();
  });

  it('„Übernehmen“ reicht den getrimmten Text ohne Verortung', async () => {
    const uebergib = vi.fn().mockResolvedValue({});
    renderMitProviders(<Harness uebergib={uebergib} />);
    const feld = await screen.findByLabelText('Lage-Text');
    await userEvent.clear(feld);
    await userEvent.type(feld, '  Deich hält  ');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(uebergib).toHaveBeenCalledTimes(1));
    expect(uebergib.mock.calls[0][0]).toEqual({
      text: 'Deich hält',
      lat: undefined,
      lon: undefined,
    });
  });

  it('eine Ablehnung steht unter „Nicht übernommen“, der Text bleibt', async () => {
    const uebergib = vi.fn().mockRejectedValue(new ApiError(409, 'Schon in der Lage'));
    renderMitProviders(<Harness uebergib={uebergib} />);
    const feld = await screen.findByLabelText('Lage-Text');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const dialog = screen.getByRole('dialog', { name: 'In die Lage übernehmen' });
    expect(await within(dialog).findByText('Nicht übernommen')).toBeInTheDocument();
    expect(within(dialog).getByText('Schon in der Lage')).toBeInTheDocument();
    expect(feld).toHaveValue('Deich bei km 3 durchweicht');
  });
});

/**
 * Review-Befund (LLH-2010): Das Formular überlebt das Schließen. Ohne eigenes Formular je Meldung
 * stünde beim Öffnen für Meldung B noch der Text von A, und „Übernehmen“ schriebe ihn zu B.
 */
describe('LagerelevantModal — je Meldung ein frisches Formular', () => {
  function Wechsel() {
    const [meldung, setMeldung] = useState<Meldung | null>({ id: 1, inhalt: 'Text A' } as Meldung);
    return (
      <>
        <button type="button" onClick={() => setMeldung({ id: 2, inhalt: 'Text B' } as Meldung)}>
          Meldung B
        </button>
        <LagerelevantModal
          offen={meldung !== null}
          meldung={meldung}
          senden={false}
          einsatzId={1}
          onAbbrechen={() => setMeldung(null)}
          onUebergeben={() => Promise.resolve()}
        />
      </>
    );
  }

  it('nach Abbrechen bei A zeigt der Dialog für B den Text von B', async () => {
    renderMitProviders(<Wechsel />);
    expect(await screen.findByDisplayValue('Text A')).toBeInTheDocument();
    await userEvent.click(kreuz());
    await userEvent.click(screen.getByRole('button', { name: 'Meldung B' }));
    // jsdom hält den schließenden Dialog eingehängt: nur der offene zählt.
    await waitFor(() => {
      const offen = screen
        .getAllByRole('dialog', { name: 'In die Lage übernehmen' })
        .filter((d) => !d.classList.contains('ant-zoom-leave'));
      expect(offen).toHaveLength(1);
      expect(within(offen[0]).getByLabelText('Lage-Text')).toHaveValue('Text B');
    });
  });
});
