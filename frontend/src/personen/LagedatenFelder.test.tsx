import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { VermisstSeitFeld } from './LagedatenFelder';

/**
 * LFH-692 (Spec `zeiteingabe`): „vermisst seit“ hält im Formular den Wire-String; das Feld zeigt
 * und liest die Anzeigezone. Browser auf UTC, Organisation auf Europe/Berlin.
 */
describe('VermisstSeitFeld — Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  function zeige(onFinish = vi.fn()) {
    render(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <Form onFinish={onFinish} initialValues={{ vermisst_seit: '2026-09-24 10:00:00' }}>
          <VermisstSeitFeld />
          <button type="submit">ok</button>
        </Form>
      </AnzeigeKonventionenProvider>,
    );
    return onFinish;
  }

  it('zeigt die Berliner Uhrzeit, und Speichern ohne Änderung lässt den Wire-String gleich', async () => {
    const onFinish = zeige();
    expect(screen.getByRole('textbox', { name: 'vermisst seit' })).toHaveValue('24.09.2026 12:00');
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(onFinish.mock.calls[0][0]).toEqual({ vermisst_seit: '2026-09-24 10:00:00' });
  });

  it('eine eingegebene 08:30 Berliner Zeit wird 06:30 UTC', async () => {
    const onFinish = zeige();
    const feld = screen.getByRole('textbox', { name: 'vermisst seit' });
    await userEvent.click(feld);
    await userEvent.clear(feld);
    await userEvent.type(feld, '24.09.2026 08:30');
    await userEvent.keyboard('{Enter}');
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(onFinish.mock.calls[0][0]).toEqual({ vermisst_seit: '2026-09-24 06:30:00' });
  });
});
