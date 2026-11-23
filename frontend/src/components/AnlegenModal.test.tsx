import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { useState } from 'react';
import { neuerQueryClient, renderMitProviders, setzeOnline } from '../test/utils';
import { ApiError, NetzFehler } from '../api/client';
import { bestaetigeVerwerfen, ohneVerwerfenRueckfrage } from '../test/verwerfen';
import AnlegenModal from './AnlegenModal';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';

interface Eingabe {
  bezeichnung: string;
}

/** Dialog mit Öffnen-Knopf und Einsatzwechsel, wie Liste und Switcher ihn nutzen. */
function Harness({ legeAn }: { legeAn: (einsatzId: number, d: Eingabe) => Promise<unknown> }) {
  const [offen, setOffen] = useState(true);
  const [einsatzId, setEinsatzId] = useState(1);
  // Escape erreicht den Abbruch nur über die Tastatur-Registry der Sprungpalette.
  return (
    <CommandPaletteProvider>
      <button type="button" onClick={() => setOffen(true)}>
        Öffnen
      </button>
      <button type="button" onClick={() => setEinsatzId(2)}>
        Zu Einsatz B
      </button>
      <output aria-label="Zustand">{offen ? 'offen' : 'zu'}</output>
      <AnlegenModal<unknown, Eingabe>
        einsatzId={einsatzId}
        open={offen}
        onClose={() => setOffen(false)}
        titel="Ding anlegen"
        erfolgText="Ding angelegt"
        legeAn={legeAn}
        listenKey={(id) => ['dinge', id]}
      >
        <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </AnlegenModal>
    </CommandPaletteProvider>
  );
}

/**
 * Der Dialog. Ob er geschlossen ist, sagt der Zustand des Harness: rc-motion beendet die
 * Ausblende-Animation in jsdom nicht, ein schließender Dialog bliebe im Baum.
 */
function offenerDialog(): HTMLElement {
  // Die beantwortete Rückfrage „Eingaben verwerfen?“ bleibt in jsdom im Baum (LLH-1755).
  const offen = ohneVerwerfenRueckfrage(screen.getAllByRole('dialog'));
  expect(offen).toHaveLength(1);
  return offen[0];
}

async function legeAn(text = 'Ding 1') {
  await userEvent.type(within(offenerDialog()).getByLabelText('Bezeichnung'), text);
  await userEvent.click(within(offenerDialog()).getByRole('button', { name: 'Anlegen' }));
}

describe('AnlegenModal (LFH-1077, LLH-1921)', () => {
  it('zeigt den Grund einer Ablehnung im Dialog, die Eingabe bleibt, kein Toast', async () => {
    const lege = vi.fn().mockRejectedValue(new ApiError(422, 'Bezeichnung schon vergeben'));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();

    const dialog = offenerDialog();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Bezeichnung schon vergeben',
    );
    expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('Ding 1');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('räumt den Grund beim nächsten Absenden', async () => {
    const lege = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'Bezeichnung schon vergeben'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();
    await within(offenerDialog()).findByText('Bezeichnung schon vergeben');

    await userEvent.click(within(offenerDialog()).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(lege).toHaveBeenCalledTimes(2));
    expect(within(offenerDialog()).queryByText('Bezeichnung schon vergeben')).toBeNull();
  });

  // Positivkontrolle zur Sperre unten: ohne laufendes Anlegen schließt Escape.
  it('schließt per Escape, solange nichts gespeichert wird', async () => {
    renderMitProviders(<Harness legeAn={vi.fn()} />);
    await waitFor(() =>
      expect(within(offenerDialog()).getByLabelText('Bezeichnung')).toHaveFocus(),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByLabelText('Zustand')).toHaveTextContent('zu'));
  });

  it('lässt sich während des Anlegens nicht schließen, schließt beim Erfolg', async () => {
    let antworte: (v: unknown) => void = () => {};
    const lege = vi.fn().mockImplementation(() => new Promise((r) => (antworte = r)));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();
    await waitFor(() => expect(lege).toHaveBeenCalledTimes(1));

    const dialog = offenerDialog();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByLabelText('Zustand')).toHaveTextContent('offen');

    await act(async () => antworte({ id: 1 }));
    expect(await screen.findByText('Ding angelegt')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Zustand')).toHaveTextContent('zu'));
  });

  it('ohne Netz: zeigt den Grund im Dialog, Abbrechen schließt (LLH-1950)', async () => {
    const lege = vi.fn().mockRejectedValue(new NetzFehler());
    setzeOnline(false);
    try {
      renderMitProviders(<Harness legeAn={lege} />);
      await legeAn();

      expect(await within(offenerDialog()).findByRole('alert')).toHaveTextContent(
        'NICHT abgeschickt',
      );
      expect(lege).toHaveBeenCalledTimes(1);
      const abbrechen = within(offenerDialog()).getByRole('button', { name: 'Abbrechen' });
      expect(abbrechen).toBeEnabled();
      await userEvent.click(abbrechen);
      await bestaetigeVerwerfen();
      expect(screen.getByLabelText('Zustand')).toHaveTextContent('zu');
    } finally {
      setzeOnline(true);
    }
  });

  it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
    const lege = vi.fn().mockRejectedValue(new ApiError(422, 'Bezeichnung schon vergeben'));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();
    await within(offenerDialog()).findByText('Bezeichnung schon vergeben');

    await userEvent.click(within(offenerDialog()).getByRole('button', { name: 'Abbrechen' }));
    // Geänderte Eingaben gehen erst nach der Rückfrage verloren (LLH-1755).
    await bestaetigeVerwerfen();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByLabelText('Zustand')).toHaveTextContent('offen');
    await waitFor(() =>
      expect(within(offenerDialog()).getByLabelText('Bezeichnung')).toHaveValue(''),
    );
    expect(within(offenerDialog()).queryByRole('alert')).toBeNull();
  });

  it('meldet eine Ablehnung aus dem vorigen Einsatz nicht im neuen', async () => {
    let lehneAb: (e: Error) => void = () => {};
    const lege = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_r, reject) => (lehneAb = reject)))
      .mockImplementation(() => new Promise(() => {}));
    const client = neuerQueryClient();
    renderMitProviders(<Harness legeAn={lege} />, { client });
    await legeAn();
    await waitFor(() => expect(lege).toHaveBeenCalledWith(1, { bezeichnung: 'Ding 1' }));

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    // Im neuen Einsatz sperrt das laufende Anlegen des vorigen kein Abbrechen.
    await waitFor(() =>
      expect(within(offenerDialog()).getByRole('button', { name: 'Abbrechen' })).toBeEnabled(),
    );
    act(() => lehneAb(new ApiError(422, 'Bezeichnung schon vergeben')));
    // Erst prüfen, wenn die Ablehnung angekommen ist und die Beobachter sie gesehen haben.
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(within(offenerDialog()).queryByRole('alert')).toBeNull();
  });
  it('legt in einem Dialog an, nicht in einer Seitenleiste', () => {
    renderMitProviders(<Harness legeAn={vi.fn()} />);
    expect(within(offenerDialog()).getByText('Ding anlegen')).toBeInTheDocument();
    expect(document.querySelector('.ant-drawer')).toBeNull();
  });

  it('leert die Eingabe über das Schließkreuz', async () => {
    renderMitProviders(<Harness legeAn={vi.fn()} />);
    await userEvent.type(within(offenerDialog()).getByLabelText('Bezeichnung'), 'Entwurf');
    await userEvent.click(
      within(offenerDialog()).getByRole('button', { name: /Close|Schliessen|Schließen/i }),
    );
    // Geänderte Eingaben gehen erst nach der Rückfrage verloren (LLH-1755).
    await bestaetigeVerwerfen();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    await waitFor(() =>
      expect(within(offenerDialog()).getByLabelText('Bezeichnung')).toHaveValue(''),
    );
  });

  it('meldet den neuen Datensatz nach dem Anlegen', async () => {
    const onAngelegt = vi.fn();
    renderMitProviders(
      <AnlegenModal<{ id: number }, Eingabe>
        einsatzId={1}
        open
        onClose={() => {}}
        onAngelegt={onAngelegt}
        titel="Ding anlegen"
        erfolgText="Ding angelegt"
        legeAn={() => Promise.resolve({ id: 7 })}
        listenKey={(id) => ['dinge', id]}
      >
        <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </AnlegenModal>,
    );
    await legeAn();
    await waitFor(() => expect(onAngelegt).toHaveBeenCalledWith({ id: 7 }));
  });
});
