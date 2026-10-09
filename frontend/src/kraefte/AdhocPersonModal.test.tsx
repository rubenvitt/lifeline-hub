import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from 'antd';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import AdhocPersonModal from './AdhocPersonModal';

describe('AdhocPersonModal', () => {
  it('meldet die angelegte Disposition zurück und schliesst', async () => {
    let body: unknown;
    server.use(
      http.post('/api/einsaetze/1/personal', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 77, einsatz_id: 1, name: 'Dr. Schmidt' }, { status: 201 });
      }),
    );
    const onAngelegt = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <AdhocPersonModal offen einsatzId={1} onSchliessen={onSchliessen} onAngelegt={onAngelegt} />,
    );

    await userEvent.type(await screen.findByLabelText('Name'), 'Dr. Schmidt');
    await userEvent.click(screen.getByRole('button', { name: 'Disponieren' }));

    await waitFor(() =>
      expect(onAngelegt).toHaveBeenCalledWith(expect.objectContaining({ id: 77 })),
    );
    expect(onSchliessen).toHaveBeenCalled();
    expect(body).toEqual({ adhoc: expect.objectContaining({ name: 'Dr. Schmidt' }) });
  });

  it('bietet „Speichern und nächste" nur im Serienmodus an', async () => {
    const { unmount } = renderMitProviders(
      <AdhocPersonModal offen einsatzId={1} onSchliessen={() => {}} />,
    );
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).toBeNull();
    unmount();

    renderMitProviders(<AdhocPersonModal offen serie einsatzId={1} onSchliessen={() => {}} />);
    expect(
      await screen.findByRole('button', { name: 'Speichern und nächste' }),
    ).toBeInTheDocument();
  });

  /**
   * Der Grund einer Ablehnung steht im Dialog, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“). Personal-Liste und Stab-Besetzung erben ihn beide von hier.
   */
  describe('Ablehnung im Dialog (LFH-1077)', () => {
    function Harness() {
      const [offen, setOffen] = useState(true);
      return (
        <>
          <Button onClick={() => setOffen(true)}>Wieder öffnen</Button>
          <AdhocPersonModal offen={offen} einsatzId={1} onSchliessen={() => setOffen(false)} />
        </>
      );
    }

    const ablehnen = () =>
      http.post('/api/einsaetze/1/personal', () =>
        HttpResponse.json({ error: 'Name bereits disponiert' }, { status: 409 }),
      );

    it('nennt den Grund im Dialog, behält den Namen und zeigt keinen Toast', async () => {
      server.use(ablehnen());
      const onSchliessen = vi.fn();
      const nutzer = userEvent.setup();
      renderMitProviders(<AdhocPersonModal offen einsatzId={1} onSchliessen={onSchliessen} />);

      const dialog = await screen.findByRole('dialog');
      await nutzer.type(within(dialog).getByLabelText('Name'), 'Dr. Schmidt');
      await nutzer.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Name bereits disponiert');
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Dr. Schmidt');
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
      expect(onSchliessen).not.toHaveBeenCalled();
    });

    it('das nächste Absenden räumt den Grund', async () => {
      let zweiter = false;
      server.use(
        http.post('/api/einsaetze/1/personal', async () => {
          if (!zweiter) {
            zweiter = true;
            return HttpResponse.json({ error: 'Name bereits disponiert' }, { status: 409 });
          }
          // Die zweite Antwort bleibt aus: geprüft wird der Zustand, solange sie aussteht.
          await new Promise(() => {});
          return HttpResponse.json({});
        }),
      );
      const nutzer = userEvent.setup();
      renderMitProviders(<AdhocPersonModal offen einsatzId={1} onSchliessen={() => {}} />);

      const dialog = await screen.findByRole('dialog');
      await nutzer.type(within(dialog).getByLabelText('Name'), 'Dr. Schmidt');
      await nutzer.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
      await within(dialog).findByRole('alert');

      await nutzer.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
      await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    });

    it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
      server.use(ablehnen());
      const nutzer = userEvent.setup();
      renderMitProviders(<Harness />);

      const dialog = await screen.findByRole('dialog');
      await nutzer.type(within(dialog).getByLabelText('Name'), 'Dr. Schmidt');
      await nutzer.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
      await within(dialog).findByRole('alert');

      // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs
      // ein, und jsdom beendet die Animation nie.
      await nutzer.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
      const wieder = await screen.findByRole('dialog');
      await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
    });
  });
});
