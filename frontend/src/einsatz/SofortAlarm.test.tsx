import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SofortAlarm from './SofortAlarm';
import { istSofortGemutet } from './sofortTon';

function renderAlarm() {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={['/einsaetze/1/meldungen']}>
        <Routes><Route path="/einsaetze/:id/meldungen" element={<SofortAlarm />} /></Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

afterEach(() => localStorage.clear());

describe('SofortAlarm', () => {
  it('zeigt einen Toast bei window-Event lfh:sofortmeldung', async () => {
    renderAlarm();
    act(() => { window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 3 } })); });
    await waitFor(() => expect(screen.getByText('Sofortmeldung eingegangen')).toBeInTheDocument());
  });

  it('Mute-Toggle persistiert in localStorage', async () => {
    renderAlarm();
    expect(istSofortGemutet()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Sofort-Ton stummschalten' }));
    expect(istSofortGemutet()).toBe(true);
    // Wieder einschalten.
    await userEvent.click(screen.getByRole('button', { name: 'Sofort-Ton einschalten' }));
    expect(istSofortGemutet()).toBe(false);
  });
});
