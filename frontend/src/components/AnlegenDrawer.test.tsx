import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { useState } from 'react';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import AnlegenDrawer from './AnlegenDrawer';

interface Eingabe {
  bezeichnung: string;
}

/** Drawer mit Öffnen-Knopf und Einsatzwechsel, wie Liste und Switcher ihn nutzen. */
function Harness({ legeAn }: { legeAn: (einsatzId: number, d: Eingabe) => Promise<unknown> }) {
  const [offen, setOffen] = useState(true);
  const [einsatzId, setEinsatzId] = useState(1);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Öffnen
      </button>
      <button type="button" onClick={() => setEinsatzId(2)}>
        Zu Einsatz B
      </button>
      <AnlegenDrawer<unknown, Eingabe>
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
      </AnlegenDrawer>
    </>
  );
}

/** Offen trägt die Wurzel `ant-drawer-open`; rc-drawer lässt einen schließenden in jsdom stehen. */
const istOffen = (d: HTMLElement) => d.closest('.ant-drawer-open') != null;

function offenerDrawer(): HTMLElement {
  const offen = screen.getAllByRole('dialog').filter(istOffen);
  expect(offen).toHaveLength(1);
  return offen[0];
}

async function legeAn(text = 'Ding 1') {
  await userEvent.type(within(offenerDrawer()).getByLabelText('Bezeichnung'), text);
  await userEvent.click(within(offenerDrawer()).getByRole('button', { name: 'Anlegen' }));
}

describe('AnlegenDrawer (LFH-1077)', () => {
  it('zeigt den Grund einer Ablehnung im Drawer, die Eingabe bleibt, kein Toast', async () => {
    const lege = vi.fn().mockRejectedValue(new ApiError(422, 'Bezeichnung schon vergeben'));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();

    const drawer = offenerDrawer();
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'Bezeichnung schon vergeben',
    );
    expect(within(drawer).getByLabelText('Bezeichnung')).toHaveValue('Ding 1');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('räumt den Grund beim nächsten Absenden', async () => {
    const lege = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'Bezeichnung schon vergeben'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();
    await within(offenerDrawer()).findByText('Bezeichnung schon vergeben');

    await userEvent.click(within(offenerDrawer()).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(lege).toHaveBeenCalledTimes(2));
    expect(within(offenerDrawer()).queryByText('Bezeichnung schon vergeben')).toBeNull();
  });

  it('lässt sich während des Anlegens nicht schließen, schließt beim Erfolg', async () => {
    let antworte: (v: unknown) => void = () => {};
    const lege = vi.fn().mockImplementation(() => new Promise((r) => (antworte = r)));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();
    await waitFor(() => expect(lege).toHaveBeenCalledTimes(1));

    const drawer = offenerDrawer();
    expect(within(drawer).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(offenerDrawer()).toBe(drawer);

    await act(async () => antworte({ id: 1 }));
    expect(await screen.findByText('Ding angelegt')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole('dialog').filter(istOffen)).toHaveLength(0));
  });

  it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
    const lege = vi.fn().mockRejectedValue(new ApiError(422, 'Bezeichnung schon vergeben'));
    renderMitProviders(<Harness legeAn={lege} />);
    await legeAn();
    await within(offenerDrawer()).findByText('Bezeichnung schon vergeben');

    await userEvent.click(within(offenerDrawer()).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    await waitFor(() =>
      expect(within(offenerDrawer()).getByLabelText('Bezeichnung')).toBeVisible(),
    );
    expect(within(offenerDrawer()).queryByRole('alert')).toBeNull();
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
      expect(within(offenerDrawer()).getByRole('button', { name: 'Abbrechen' })).toBeEnabled(),
    );
    act(() => lehneAb(new ApiError(422, 'Bezeichnung schon vergeben')));
    // Erst prüfen, wenn die Ablehnung angekommen ist und die Beobachter sie gesehen haben.
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(within(offenerDrawer()).queryByRole('alert')).toBeNull();
  });
});
