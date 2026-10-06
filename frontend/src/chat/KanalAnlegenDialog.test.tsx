import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderMitProviders } from '../test/utils';
import KanalAnlegenDialog from './KanalAnlegenDialog';

/** Hält den Offen-Zustand wie die Aufrufer (`KanalListe`, schmale Leiste in `ChatPage`). */
function Rahmen({
  onKanalAnlegen,
}: {
  onKanalAnlegen: (n: string, b?: string) => Promise<unknown>;
}) {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        öffnen
      </button>
      <KanalAnlegenDialog
        offen={offen}
        onSchliessen={() => setOffen(false)}
        onKanalAnlegen={onKanalAnlegen}
      />
    </>
  );
}

describe('KanalAnlegenDialog', () => {
  it('sendet per Enter im Namensfeld, getrimmt und ohne leere Beschreibung', async () => {
    const user = userEvent.setup();
    const onKanalAnlegen = vi.fn(() => Promise.resolve());
    renderMitProviders(<Rahmen onKanalAnlegen={onKanalAnlegen} />);

    expect(screen.getByRole('dialog', { name: 'Neuer Kanal' })).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Name'), '  Verpflegung  {Enter}');
    await waitFor(() => expect(onKanalAnlegen).toHaveBeenCalledWith('Verpflegung', undefined));
  });

  it('gibt eine Beschreibung getrimmt weiter', async () => {
    const user = userEvent.setup();
    const onKanalAnlegen = vi.fn(() => Promise.resolve());
    renderMitProviders(<Rahmen onKanalAnlegen={onKanalAnlegen} />);

    await user.type(await screen.findByLabelText('Name'), 'Abschnitt Nord');
    await user.type(screen.getByLabelText('Beschreibung (optional)'), '  Deich  ');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onKanalAnlegen).toHaveBeenCalledWith('Abschnitt Nord', 'Deich'));
  });

  it('sendet ohne Namen nichts', async () => {
    const user = userEvent.setup();
    const onKanalAnlegen = vi.fn(() => Promise.resolve());
    renderMitProviders(<Rahmen onKanalAnlegen={onKanalAnlegen} />);

    await user.type(await screen.findByLabelText('Name'), '   {Enter}');
    expect(await screen.findByText('Name erforderlich')).toBeInTheDocument();
    expect(onKanalAnlegen).not.toHaveBeenCalled();
  });

  it('bleibt bei Ablehnung offen und behält die Eingaben (LFH-795)', async () => {
    const user = userEvent.setup();
    const onKanalAnlegen = vi.fn(() => Promise.reject(new Error('409')));
    renderMitProviders(<Rahmen onKanalAnlegen={onKanalAnlegen} />);

    await user.type(await screen.findByLabelText('Name'), 'Allgemein');
    await user.type(screen.getByLabelText('Beschreibung (optional)'), 'Doppelt');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onKanalAnlegen).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave');
    expect(screen.getByLabelText('Name')).toHaveValue('Allgemein');
    expect(screen.getByLabelText('Beschreibung (optional)')).toHaveValue('Doppelt');
  });

  it('schliesst erst nach Erfolg und ist beim nächsten Öffnen leer', async () => {
    const user = userEvent.setup();
    let erfuellen!: () => void;
    const onKanalAnlegen = vi.fn(() => new Promise<void>((r) => (erfuellen = r)));
    renderMitProviders(<Rahmen onKanalAnlegen={onKanalAnlegen} />);

    await user.type(await screen.findByLabelText('Name'), 'Abschnitt Nord');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onKanalAnlegen).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave');
    await act(async () => erfuellen());
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'));

    await user.click(screen.getByRole('button', { name: 'öffnen' }));
    expect(await screen.findByLabelText('Name')).toHaveValue('');
  });

  it('schliesst über „Abbrechen", ohne zu senden', async () => {
    const user = userEvent.setup();
    const onKanalAnlegen = vi.fn(() => Promise.resolve());
    renderMitProviders(<Rahmen onKanalAnlegen={onKanalAnlegen} />);

    await user.type(await screen.findByLabelText('Name'), 'Verworfen');
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'));
    expect(onKanalAnlegen).not.toHaveBeenCalled();
  });
});
