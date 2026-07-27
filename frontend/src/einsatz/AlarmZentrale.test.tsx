import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router';
import AlarmZentrale from './AlarmZentrale';
import { istAlarmGemutet } from '../alarm/alarmTon';

function renderAlarm() {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={['/einsaetze/1/meldungen']}>
        <Routes><Route path="/einsaetze/:id/meldungen" element={<AlarmZentrale />} /></Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

afterEach(() => localStorage.clear());

describe('AlarmZentrale', () => {
  it('zeigt einen Toast bei window-Event lfh:sofortmeldung', async () => {
    renderAlarm();
    act(() => { window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 3 } })); });
    await waitFor(() => expect(screen.getByText('Sofortmeldung eingegangen')).toBeInTheDocument());
  });

  it('zeigt einen Erinnerungs-Toast bei lfh:erinnerung-alarm ohne Bezug', async () => {
    renderAlarm();
    act(() => { window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', { detail: { erinnerung_id: 5, bezug_typ: null, bezug_id: null } })); });
    await waitFor(() => expect(screen.getByText('Erinnerung fällig')).toBeInTheDocument());
  });

  it('zeigt einen Auftrags-Toast bei lfh:erinnerung-alarm mit bezug_typ=auftrag', async () => {
    renderAlarm();
    act(() => { window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', { detail: { erinnerung_id: 6, bezug_typ: 'auftrag', bezug_id: 12 } })); });
    await waitFor(() => expect(screen.getByText('Auftrag überfällig')).toBeInTheDocument());
  });

  it('globaler Mute-Toggle persistiert in localStorage', async () => {
    renderAlarm();
    expect(istAlarmGemutet()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Alarm-Ton stummschalten' }));
    expect(istAlarmGemutet()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Alarm-Ton einschalten' }));
    expect(istAlarmGemutet()).toBe(false);
  });
});
