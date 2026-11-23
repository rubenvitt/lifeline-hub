import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Input, Modal } from 'antd';
import { useState } from 'react';
import { renderMitProviders } from '../test/utils';
import { useVerwerfenSchutz } from './VerlassenRueckfrage';

/**
 * LLH-2010: Handgebaute Dialoge mit gesteuerten Feldern schützen Eingaben wie die Erfassungshülle
 * (`frontend/AGENTS.md`, „Erfassungs-Norm“): die Maske schließt nie, mit Eingabe fragt jeder Weg
 * hinaus „Eingaben verwerfen?“.
 */
function Probe({
  onSchliessen,
  gesperrt = false,
}: {
  onSchliessen: () => void;
  gesperrt?: boolean;
}) {
  const [text, setText] = useState('');
  const schutz = useVerwerfenSchutz({
    geaendert: text.trim() !== '',
    gesperrt,
    titel: 'Probe',
    onSchliessen,
  });
  return (
    <>
      <Modal title="Probe" open footer={null} {...schutz.modalProps}>
        <Input aria-label="Text" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        <Button onClick={schutz.abbrechen}>Abbrechen</Button>
      </Modal>
      {schutz.rueckfrage}
    </>
  );
}

const kreuz = () => screen.getByRole('button', { name: /Close|Schliessen|Schließen/i });
/** Die Rückfrage, solange sie steht; beim Ausblenden (`ant-zoom-leave`) gilt sie als zu. */
const rueckfrage = () => {
  const d = screen.queryByRole('dialog', { name: 'Eingaben verwerfen?' });
  return d && !d.classList.contains('ant-zoom-leave') ? d : null;
};

describe('useVerwerfenSchutz (LLH-2010)', () => {
  it('ohne Eingabe schließt das Kreuz sofort', async () => {
    const onSchliessen = vi.fn();
    renderMitProviders(<Probe onSchliessen={onSchliessen} />);
    await userEvent.click(kreuz());
    expect(onSchliessen).toHaveBeenCalledTimes(1);
    expect(rueckfrage()).toBeNull();
  });

  it('die Maske schließt nicht, weder ohne noch mit Eingabe', async () => {
    const onSchliessen = vi.fn();
    renderMitProviders(<Probe onSchliessen={onSchliessen} />);
    const maske = document.querySelector<HTMLElement>('.ant-modal-wrap');
    expect(maske).not.toBeNull();
    await userEvent.click(maske!);
    await userEvent.type(screen.getByLabelText('Text'), 'abc');
    await userEvent.click(maske!);
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(rueckfrage()).toBeNull();
  });

  it('mit Eingabe fragt das Kreuz nach; „Weiter bearbeiten“ behält Text und Fokus', async () => {
    const onSchliessen = vi.fn();
    renderMitProviders(<Probe onSchliessen={onSchliessen} />);
    const feld = screen.getByLabelText('Text');
    await userEvent.type(feld, 'abc');
    await userEvent.click(kreuz());
    expect(await screen.findByText('Die Eingaben in „Probe“ gehen verloren.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('abc');
    await waitFor(() => expect(feld).toHaveFocus());
  });

  it('„Verwerfen“ schließt', async () => {
    const onSchliessen = vi.fn();
    renderMitProviders(<Probe onSchliessen={onSchliessen} />);
    await userEvent.type(screen.getByLabelText('Text'), 'abc');
    await userEvent.click(kreuz());
    await userEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    expect(onSchliessen).toHaveBeenCalledTimes(1);
  });

  it('Escape öffnet die Rückfrage, ein zweites Escape schließt nur die Rückfrage', async () => {
    const onSchliessen = vi.fn();
    renderMitProviders(<Probe onSchliessen={onSchliessen} />);
    await userEvent.type(screen.getByLabelText('Text'), 'abc');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText(/gehen verloren\./)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Weiter bearbeiten' })).toHaveFocus(),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(rueckfrage()).toBeNull());
    // Dasselbe Escape öffnet sie nicht gleich wieder.
    await new Promise((r) => setTimeout(r, 50));
    expect(rueckfrage()).toBeNull();
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Text')).toHaveValue('abc');
  });

  it('auch beim zweiten Öffnen steht der Fokus auf „Weiter bearbeiten“ (LLH-2013)', async () => {
    renderMitProviders(<Probe onSchliessen={vi.fn()} />);
    const feld = screen.getByLabelText('Text');
    await userEvent.type(feld, 'abc');
    for (const runde of [1, 2]) {
      await userEvent.keyboard('{Escape}');
      const weiter = await screen.findByRole('button', { name: 'Weiter bearbeiten' });
      await waitFor(() => expect(weiter, `Runde ${runde}`).toHaveFocus());
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(rueckfrage()).toBeNull());
      await waitFor(() => expect(feld).toHaveFocus());
      // jsdom beendet die Ausblendung nie; im Browser ist sie nach 0,2 s fertig.
      await waitFor(() => {
        const gehend = document.querySelector<HTMLElement>('.ant-zoom-leave');
        if (gehend) {
          fireEvent.transitionEnd(gehend);
          fireEvent.animationEnd(gehend);
        }
        expect(document.querySelector('.ant-zoom-leave')).toBeNull();
      });
    }
    expect(feld).toHaveValue('abc');
  });

  it('zieht eine Fokusfalle den Fokus beim Öffnen auf das Kreuz der Rückfrage, holt sie ihn zurück (LLH-2013)', async () => {
    renderMitProviders(<Probe onSchliessen={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Text'), 'abc');
    await userEvent.keyboard('{Escape}');
    const offen = await screen.findByRole('dialog', { name: 'Eingaben verwerfen?' });
    const weiter = screen.getByRole('button', { name: 'Weiter bearbeiten' });
    // Was rc-dialogs `useLockFocus` im Browser tut (jsdom kennt die Falle nicht): Fokus auf das
    // erste fokussierbare Element der Rückfrage, ihr Kreuz; danach auf ihren Rahmen.
    act(() => offen.querySelector<HTMLElement>('.ant-modal-close')!.focus());
    expect(weiter).toHaveFocus();
    act(() => offen.closest<HTMLElement>('.ant-modal')!.focus());
    expect(weiter).toHaveFocus();
  });

  it('gesperrt tut das Kreuz nichts', async () => {
    const onSchliessen = vi.fn();
    renderMitProviders(<Probe onSchliessen={onSchliessen} gesperrt />);
    await userEvent.click(kreuz());
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(rueckfrage()).toBeNull();
  });

  it('ein eigener Abbrechen-Knopf über abbrechen() fragt wie das Kreuz', async () => {
    const onSchliessen = vi.fn();
    renderMitProviders(<Probe onSchliessen={onSchliessen} />);
    await userEvent.type(screen.getByLabelText('Text'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByText(/gehen verloren\./)).toBeInTheDocument();
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});
