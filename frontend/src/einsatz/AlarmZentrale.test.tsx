import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App as AntApp } from 'antd';
import { StrictMode, useState } from 'react';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from 'react-router';
import AlarmZentrale from './AlarmZentrale';
import { istAlarmGemutet } from '../alarm/alarmTon';

function AlarmTestRoute({ mitSteuerung }: { mitSteuerung: boolean }) {
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [sichtbar, setSichtbar] = useState(true);

  return (
    <>
      {mitSteuerung && (
        <>
          <button type="button" onClick={() => navigate('/einsaetze/2/start')}>Einsatz wechseln</button>
          <button type="button" onClick={() => setSichtbar(false)}>Alarm-Zentrale ausblenden</button>
          <button
            type="button"
            onClick={() => notification.info({
              key: 'fremde-notification',
              title: 'Fremde Notification',
              duration: 0,
            })}
          >
            Fremde Notification öffnen
          </button>
        </>
      )}
      {sichtbar && <AlarmZentrale />}
      <output data-testid="route">{location.pathname}{location.search}</output>
    </>
  );
}

function renderAlarm({
  initialEntry = '/einsaetze/1/meldungen',
  mitSteuerung = false,
  strictMode = false,
}: {
  initialEntry?: string;
  mitSteuerung?: boolean;
  strictMode?: boolean;
} = {}) {
  const inhalt = (
    <AntApp>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/einsaetze/:id/*" element={<AlarmTestRoute mitSteuerung={mitSteuerung} />} />
        </Routes>
      </MemoryRouter>
    </AntApp>
  );
  return render(strictMode ? <StrictMode>{inhalt}</StrictMode> : inhalt);
}

/**
 * AntD wartet beim Entfernen einer Notification auf das Ende der CSS-Bewegung. jsdom
 * erzeugt dieses Ereignis nicht selbst; ohne den Anstoß bliebe eine korrekt zerstörte
 * Notice mit `*-leave-active` im Test-DOM stehen.
 */
async function warteBisNotificationWeg(titel: string) {
  await waitFor(() => {
    const notice = screen.queryByText(titel)?.closest<HTMLElement>('.ant-notification-notice');
    if (notice) {
      fireEvent.transitionEnd(notice);
      fireEvent.animationEnd(notice);
      notice.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }));
    }
    expect(screen.queryByText(titel)).not.toBeInTheDocument();
  });
}

function stubAudioReady() {
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    resume: vi.fn(async () => {}),
    createOscillator: vi.fn(() => ({
      type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      gain: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn(),
    })),
  };
  vi.stubGlobal('AudioContext', vi.fn(function () { return ctx; }));
}

function stubNotification(permission: NotificationPermission) {
  const Ctor = vi.fn(function () {
    return { close: vi.fn(), onclick: null };
  }) as unknown as typeof Notification & {
    permission: NotificationPermission;
    requestPermission: ReturnType<typeof vi.fn>;
  };
  Ctor.permission = permission;
  Ctor.requestPermission = vi.fn(async () => {
    Ctor.permission = 'granted';
    return 'granted' as NotificationPermission;
  });
  vi.stubGlobal('Notification', Ctor);
  return Ctor;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

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
    stubAudioReady();
    renderAlarm();
    expect(await screen.findByText('Ton bereit')).toBeInTheDocument();
    expect(istAlarmGemutet()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Alarmton stummschalten' }));
    expect(istAlarmGemutet()).toBe(true);
    expect(screen.getByText('Ton stumm')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alarmton einschalten' }));
    expect(istAlarmGemutet()).toBe(false);
  });

  it('zeigt den Desktop-Status dauerhaft als Tri-State und aktiviert aus der User-Geste', async () => {
    const NotificationMock = stubNotification('default');
    renderAlarm();
    const aus = screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: aus' });
    expect(aus).toHaveTextContent('Desktop aus');
    await userEvent.click(aus);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: erlaubt' }))
        .toHaveTextContent('Desktop erlaubt');
    });
    expect(NotificationMock.requestPermission).toHaveBeenCalledOnce();
  });

  it('zeigt Browser-Blockade dauerhaft an', () => {
    stubNotification('denied');
    renderAlarm();
    expect(screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: blockiert' }))
      .toHaveTextContent('Desktop blockiert');
  });

  it('bündelt beim vierten Sofort-Ereignis die drei vorherigen und behält das neueste einzeln', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      for (let meldung_id = 1; meldung_id <= 4; meldung_id += 1) {
        window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id } }));
      }
    });

    expect(await screen.findByText('3 weitere Sofortmeldungen')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelectorAll('.ant-notification-notice').length).toBeLessThanOrEqual(3);
    });
    expect(screen.getAllByText('Sofortmeldung eingegangen')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Zu Meldungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/meldungen');
  });

  it('räumt beim Einsatzwechsel und Unmount nur die eigenen langlebigen Toasts ab', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start', mitSteuerung: true, strictMode: true });
    act(() => {
      for (let meldung_id = 1; meldung_id <= 4; meldung_id += 1) {
        window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id } }));
      }
    });
    expect(await screen.findByText('Sofortmeldung eingegangen')).toBeInTheDocument();
    expect(screen.getByText('3 weitere Sofortmeldungen')).toBeInTheDocument();
    const alteSammelAktion = screen.getByRole('button', { name: 'Zu Meldungen' });

    await userEvent.click(screen.getByRole('button', { name: 'Fremde Notification öffnen' }));
    expect(await screen.findByText('Fremde Notification')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Einsatz wechseln' }));

    // Selbst während AntD die alte Notice noch ausblendet, darf deren Aktion nicht
    // mehr zur Route des vorherigen Einsatzes springen.
    await userEvent.click(alteSammelAktion);
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/2/start');
    await warteBisNotificationWeg('Sofortmeldung eingegangen');
    await warteBisNotificationWeg('3 weitere Sofortmeldungen');
    expect(screen.getByText('Fremde Notification')).toBeInTheDocument();
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/2/start');

    act(() => {
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 4 } }));
    });
    expect(await screen.findByText('Sofortmeldung eingegangen')).toBeInTheDocument();
    expect(screen.queryByText('3 weitere Sofortmeldungen')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/2/meldungen');
    await warteBisNotificationWeg('Sofortmeldung eingegangen');

    act(() => {
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 4 } }));
    });
    expect(await screen.findByText('Sofortmeldung eingegangen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alarm-Zentrale ausblenden' }));
    await warteBisNotificationWeg('Sofortmeldung eingegangen');
    expect(screen.getByText('Fremde Notification')).toBeInTheDocument();
  });

  it('bündelt vier Aufträge mit dem korrekten Auftrags-Ziel', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      for (let id = 1; id <= 4; id += 1) {
        window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', {
          detail: { erinnerung_id: id, bezug_typ: 'auftrag', bezug_id: id },
        }));
      }
    });

    expect(await screen.findByText('3 weitere Aufträge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Meldungen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Erinnerungen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Aufträgen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege');
  });

  it('bündelt vier Erinnerungen mit dem korrekten Erinnerungs-Ziel', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      for (let id = 1; id <= 4; id += 1) {
        window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', {
          detail: { erinnerung_id: id, bezug_typ: null, bezug_id: null },
        }));
      }
    });

    expect(await screen.findByText('3 weitere Erinnerungen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Meldungen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Aufträgen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Erinnerungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/erinnerungen');
  });

  it('bietet bei gemischter Bündelung getrennte Aktionen nur für betroffene Module', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 1 } }));
      window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', {
        detail: { erinnerung_id: 2, bezug_typ: 'auftrag', bezug_id: 2 },
      }));
      window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', {
        detail: { erinnerung_id: 3, bezug_typ: null, bezug_id: null },
      }));
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 4 } }));
    });

    expect(await screen.findByText('3 weitere Alarme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zu Meldungen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zu Aufträgen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Erinnerungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/erinnerungen');
  });
});
