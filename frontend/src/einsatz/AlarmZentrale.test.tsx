import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { App as AntApp } from 'antd';
import { StrictMode, useState } from 'react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useParams } from 'react-router';
import AlarmZentrale from './AlarmZentrale';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { istAlarmGemutet } from '../alarm/alarmTon';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';

dayjs.extend(utc);

function AlarmTestRoute({ mitSteuerung }: { mitSteuerung: boolean }) {
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  // Die ID reicht im App-Baum der Einsatzrahmen herein; hier steht die Route an seiner Stelle.
  const einsatzId = Number(useParams().id);
  const [sichtbar, setSichtbar] = useState(true);

  return (
    <>
      {mitSteuerung && (
        <>
          <button type="button" onClick={() => navigate('/einsaetze/2/start')}>
            Einsatz wechseln
          </button>
          <button type="button" onClick={() => setSichtbar(false)}>
            Alarm-Zentrale ausblenden
          </button>
          <button
            type="button"
            onClick={() =>
              notification.info({
                key: 'fremde-notification',
                title: 'Fremde Notification',
                duration: 0,
              })
            }
          >
            Fremde Notification öffnen
          </button>
        </>
      )}
      {sichtbar && <AlarmZentrale einsatzId={einsatzId} />}
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
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
 * antd wartet beim Entfernen einer Notification auf das Ende der CSS-Bewegung, das jsdom nicht
 * erzeugt; ohne Anstoß bliebe die zerstörte Notice mit `*-leave-active` im DOM.
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
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      gain: { value: 0, setValueAtTime: vi.fn() },
      connect: vi.fn(),
    })),
  };
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return ctx;
    }),
  );
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
  // Die breite Bauform mit Wort auch im Ruhezustand gilt erst ab `xl`; der Vorgabe-Viewport
  // (1024 px) liegt darunter.
  beforeEach(() => setzeViewportBreite(1366));

  it('zeigt einen Toast bei window-Event lfh:sofortmeldung', async () => {
    renderAlarm();
    act(() => {
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 3 } }));
    });
    await waitFor(() => expect(screen.getByText('Sofortmeldung eingegangen')).toBeInTheDocument());
  });

  it('zeigt einen Erinnerungs-Toast bei lfh:erinnerung-alarm ohne Bezug', async () => {
    renderAlarm();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:erinnerung-alarm', {
          detail: { erinnerung_id: 5, bezug_typ: null, bezug_id: null },
        }),
      );
    });
    await waitFor(() => expect(screen.getByText('Erinnerung fällig')).toBeInTheDocument());
  });

  it('zeigt einen Auftrags-Toast bei lfh:erinnerung-alarm mit bezug_typ=auftrag', async () => {
    renderAlarm();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:erinnerung-alarm', {
          detail: { erinnerung_id: 6, bezug_typ: 'auftrag', bezug_id: 12 },
        }),
      );
    });
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
      expect(
        screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: erlaubt' }),
      ).toHaveTextContent('Desktop erlaubt');
    });
    expect(NotificationMock.requestPermission).toHaveBeenCalledOnce();
  });

  it('zeigt Browser-Blockade dauerhaft an', () => {
    stubNotification('denied');
    renderAlarm();
    expect(
      screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: blockiert' }),
    ).toHaveTextContent('Desktop blockiert');
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

    // Selbst während antd die alte Notice ausblendet, darf ihre Aktion nicht zur Route des
    // vorherigen Einsatzes springen.
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
        window.dispatchEvent(
          new CustomEvent('lfh:erinnerung-alarm', {
            detail: { erinnerung_id: id, bezug_typ: 'auftrag', bezug_id: id },
          }),
        );
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
        window.dispatchEvent(
          new CustomEvent('lfh:erinnerung-alarm', {
            detail: { erinnerung_id: id, bezug_typ: null, bezug_id: null },
          }),
        );
      }
    });

    expect(await screen.findByText('3 weitere Erinnerungen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Meldungen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Aufträgen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Erinnerungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/erinnerungen');
  });

  it('zeigt einen Ablösungs-Hinweis mit Einheit und Uhrzeit und springt zur Ablösung (LFH-635)', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:abloesung-alarm', {
          detail: {
            abloesung_id: 9,
            art: 'faellig',
            titel: 'Ablösung fällig: Florian 1',
            faellig_at: '2026-09-22 13:30:00',
          },
        }),
      );
    });
    expect(await screen.findByText('Ablösung fällig')).toBeInTheDocument();
    const uhrzeit = dayjs.utc('2026-09-22 13:30:00').local().format('HH:mm');
    expect(screen.getByText(`Ablösung fällig: Florian 1, ${uhrzeit}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/abloesung');
  });

  it('Ablösung: Vorwarnung und Fälligkeit sind zwei Hinweise, die Wiederholung derselben keiner', async () => {
    renderAlarm();
    const senden = (art: 'vorwarnung' | 'faellig') =>
      window.dispatchEvent(
        new CustomEvent('lfh:abloesung-alarm', {
          detail: { abloesung_id: 9, art, titel: 'Ablösung fällig: Florian 1' },
        }),
      );
    act(() => {
      senden('vorwarnung');
      senden('faellig');
      senden('faellig');
    });
    expect(await screen.findByText('Ablösung in 30 min')).toBeInTheDocument();
    expect(screen.getAllByText('Ablösung fällig')).toHaveLength(1);
  });

  it('bündelt vier Ablösungen mit dem Ablösungs-Ziel — dasselbe Budget wie alle Quellen', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      for (let id = 1; id <= 4; id += 1) {
        window.dispatchEvent(
          new CustomEvent('lfh:abloesung-alarm', {
            detail: { abloesung_id: id, art: 'faellig', titel: `Ablösung fällig: F${id}` },
          }),
        );
      }
    });
    expect(await screen.findByText('3 weitere Ablösungen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Ablösungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/abloesung');
  });

  it('bietet bei gemischter Bündelung getrennte Aktionen nur für betroffene Module', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 1 } }));
      window.dispatchEvent(
        new CustomEvent('lfh:erinnerung-alarm', {
          detail: { erinnerung_id: 2, bezug_typ: 'auftrag', bezug_id: 2 },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('lfh:erinnerung-alarm', {
          detail: { erinnerung_id: 3, bezug_typ: null, bezug_id: null },
        }),
      );
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 4 } }));
    });

    expect(await screen.findByText('3 weitere Alarme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zu Meldungen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zu Aufträgen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Erinnerungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/erinnerungen');
  });
});

describe('AlarmZentrale: Unwetterhinweis (LFH-663)', () => {
  beforeEach(() => setzeViewportBreite(1366));

  const unwetter = (detail: { schluessel: string; titel: string; beschreibung: string }) =>
    window.dispatchEvent(new CustomEvent('lfh:unwetter-alarm', { detail }));

  it('zeigt den Hinweis mit Stufenwort und Zeitraum und springt zur Modulseite', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() =>
      unwetter({
        schluessel: 'schwer|SCHWERES GEWITTER',
        titel: 'Unwetterwarnung',
        beschreibung: 'Schweres Gewitter, ab 17:00 · bis 20:00',
      }),
    );
    expect(await screen.findByText('Unwetterwarnung')).toBeInTheDocument();
    expect(screen.getByText('Schweres Gewitter, ab 17:00 · bis 20:00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/wetter-pegel');
  });

  it('ein neuer Unwetterhinweis ersetzt den sichtbaren älteren — ein Platz im Budget', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() =>
      unwetter({
        schluessel: 'schwer|SCHWERES GEWITTER',
        titel: 'Unwetterwarnung',
        beschreibung: 'Schweres Gewitter, ab 17:00 · bis 20:00',
      }),
    );
    expect(await screen.findByText('Unwetterwarnung')).toBeInTheDocument();
    act(() =>
      unwetter({
        schluessel: 'extrem|ORKANBÖEN',
        titel: 'Extremes Unwetter',
        beschreibung: 'Orkanböen, ab 18:00 · bis 22:00',
      }),
    );
    expect(await screen.findByText('Extremes Unwetter')).toBeInTheDocument();
    await warteBisNotificationWeg('Unwetterwarnung');
    expect(screen.getAllByRole('button', { name: 'Öffnen' })).toHaveLength(1);
  });

  it('unterliegt dem gemeinsamen Budget: drei Sofortmeldungen und ein Unwetter → Zusammenfassung', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      for (let id = 1; id <= 3; id += 1) {
        window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: id } }));
      }
      unwetter({
        schluessel: 'schwer|DAUERREGEN',
        titel: 'Unwetterwarnung',
        beschreibung: 'Dauerregen, seit 08:00 · bis 20:00',
      });
    });
    expect(await screen.findByText('3 weitere Sofortmeldungen')).toBeInTheDocument();
    expect(screen.getByText('Unwetterwarnung')).toBeInTheDocument();
  });

  it('dasselbe Paar erneut, während sein alter Hinweis gebündelt ist: der neue erscheint', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    const detail = {
      schluessel: 'schwer|DAUERREGEN',
      titel: 'Unwetterwarnung',
      beschreibung: 'Dauerregen, seit 08:00 · bis 20:00',
    };
    act(() => {
      unwetter(detail);
      for (let id = 1; id <= 3; id += 1) {
        window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: id } }));
      }
    });
    expect(await screen.findByText('3 weitere Alarme')).toBeInTheDocument();
    expect(screen.queryByText('Unwetterwarnung')).not.toBeInTheDocument();
    act(() => unwetter({ ...detail, beschreibung: 'Dauerregen, seit 15:00 · bis 23:00' }));
    expect(await screen.findByText('Dauerregen, seit 15:00 · bis 23:00')).toBeInTheDocument();
  });

  it('die Zusammenfassung bietet den Weg zu Wetter & Pegel, wenn ein Unwetter darin steckt', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() => {
      unwetter({
        schluessel: 'schwer|DAUERREGEN',
        titel: 'Unwetterwarnung',
        beschreibung: 'Dauerregen, seit 08:00 · bis 20:00',
      });
      for (let id = 1; id <= 3; id += 1) {
        window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: id } }));
      }
    });
    expect(await screen.findByText('3 weitere Alarme')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Wetter & Pegel' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/wetter-pegel');
  });
});

/**
 * Die Kopfzeile auf dem Handschirm: zwei beschriftete Ziele passen auf 390 px nicht (180 px
 * verfügbar, 286 nötig) und brächen um. Die Beschriftung darf nicht zur Ikone werden, deshalb
 * EIN Ziel mit Sammelbeschriftung, die den nötigen Zustand nennt, und beide Steuerungen
 * beschriftet im Menü. Ab `md` bleiben es zwei Knöpfe; `test/viewport.ts` steht per Vorgabe auf
 * 1024 px.
 */
describe('AlarmZentrale auf dem Handschirm (LFH-511)', () => {
  afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

  it('bündelt auf 390 px zu EINEM Ziel und nennt darin den auffälligen Zustand', async () => {
    stubAudioReady();
    stubNotification('denied');
    setzeViewportBreite(390);
    renderAlarm();

    // Die zwei Ziele der breiten Bauform sind WEG — sonst erfüllte auch ein zusätzlicher Knopf die
    // Aussage.
    expect(
      screen.queryByRole('button', { name: 'Desktop-Benachrichtigungen: blockiert' }),
    ).toBeNull();
    // Über ein MUSTER über alle drei Wortlaute: `tonStatus` dreht erst einen Microtask später auf
    // `bereit`, ein Literal träfe den Knopf in diesem Moment nicht und die Zeile belegte nichts.
    expect(screen.queryByRole('button', { name: /^Alarmton / })).toBeNull();

    // An ihrer Stelle steht genau EINES, das den Zustand benennt. `findBy…`, weil das Muster schon
    // greift, bevor die Tonprüfung durch ist.
    const ziel = await screen.findByRole('button', { name: /^Alarmzentrale:/ });
    await waitFor(() => expect(ziel).toHaveTextContent('Desktop blockiert'));
    expect(screen.getAllByRole('button', { name: /^Alarmzentrale:/ })).toHaveLength(1);
  });

  it('bei erlaubtem Desktop und gutem Ton nennt die Marke den Ton', async () => {
    // Deckt `|| desktop === 'erlaubt'` ab: auch im unauffälligen Fall nennt die Marke einen
    // Zustand statt eines Sammelworts.
    stubAudioReady();
    stubNotification('granted');
    setzeViewportBreite(390);
    renderAlarm();

    const ziel = await screen.findByRole('button', { name: /^Alarmzentrale:/ });
    await waitFor(() => expect(ziel).toHaveTextContent('Ton bereit'));
  });

  it('ist der Desktop abschaltbar, ist sein Menüeintrag bedienbar und fordert die Berechtigung an', async () => {
    // Der einzige handlungsfähige Desktop-Pfad im schmalen Zweig — ohne diesen Test liefe er nie.
    stubAudioReady();
    const NotificationMock = stubNotification('default');
    setzeViewportBreite(390);
    renderAlarm();

    await userEvent.click(await screen.findByRole('button', { name: /^Alarmzentrale:/ }));
    const menue = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement;
    expect(menue, 'das Menü muss offen sein').not.toBeNull();

    const eintrag = within(menue).getByRole('menuitem', { name: /aktivieren/ });
    // Kein antd-Ikonenname im zugänglichen Namen (antds Menü hängt kein `aria-hidden` davor).
    expect(eintrag.textContent).not.toMatch(/desktop-outlined|check-circle|^stop/i);
    await userEvent.click(eintrag);
    expect(NotificationMock.requestPermission).toHaveBeenCalledOnce();
  });

  it('das gebündelte Ziel trägt beide Steuerungen mit ihrem Wortlaut', async () => {
    stubAudioReady();
    stubNotification('denied');
    setzeViewportBreite(390);
    renderAlarm();

    await userEvent.click(await screen.findByRole('button', { name: /^Alarmzentrale:/ }));
    // Über das GEÖFFNETE Menü: antd lässt geschlossene Portale im Baum.
    const menue = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement;
    expect(menue, 'das Menü muss offen sein').not.toBeNull();
    // ZWEI Einträge, einzeln gegriffen — ein Gesamttext-Vergleich erfüllte auch eine Regression,
    // die beide in EINEN legt.
    const eintraege = within(menue).getAllByRole('menuitem');
    expect(eintraege).toHaveLength(2);
    // Der Desktop-Eintrag NENNT seinen Zustand: er ist der einzige Ort dafür, wenn die Marke den
    // Ton nennt.
    expect(eintraege[0].textContent).toMatch(/im Browser blockiert/);
    // Der Ton-Eintrag nennt die HANDLUNG; „Ton bereit" an einem Eintrag, der stummschaltet, sagte
    // das Gegenteil, und es gibt keinen Tooltip.
    expect(eintraege[1].textContent).toMatch(/stummschalten/);
  });

  it('die Sammelbeschriftung nennt den Ton, sobald er stumm ist — er ist der lautere Kanal', async () => {
    stubAudioReady();
    stubNotification('denied');
    setzeViewportBreite(390);
    renderAlarm();

    await userEvent.click(await screen.findByRole('button', { name: /^Alarmzentrale:/ }));
    const menue = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement;
    expect(menue, 'das Menü muss offen sein').not.toBeNull();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /stummschalten/ }));

    expect(istAlarmGemutet()).toBe(true);
    // Bei zwei auffälligen Zuständen gewinnt der hörbare Kanal.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Alarmzentrale:/ })).toHaveTextContent(
        'Ton stumm',
      ),
    );
  });

  it('ab md bleiben es zwei Ziele — der Umbau gilt nur dem Handschirm', () => {
    stubAudioReady();
    stubNotification('denied');
    setzeViewportBreite(768);
    renderAlarm();

    expect(
      screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: blockiert' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Alarmzentrale:/ })).toBeNull();
  });
});

/**
 * LFH-513: Der gesunde Ton-Zustand trägt keinen Marker. Ein roter Punkt an „Ton bereit" verbrauchte
 * die Alarmfarbe für eine Nichtmeldung; die Störung trägt ihre Form (durchgestrichene Glocke) und
 * ihr Wort, das genügt WCAG 1.4.1 ohne Farbe. Mutationsprobe: den `<Badge dot status="error">` um
 * die gesunde Glocke zurücklegen → die Marker-Aussagen hier werden rot.
 */
describe('AlarmZentrale: Ton-Ikone ohne Marker im Ruhezustand (LFH-513)', () => {
  afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

  /** Jeder antd-Badge-Marker, gleich welcher Status — nicht nur der rote. */
  function marker(wurzel: HTMLElement) {
    return wurzel.querySelectorAll('.ant-badge, .ant-badge-dot, .ant-badge-status-dot');
  }

  function ikone(knopf: HTMLElement): string {
    const svg = knopf.querySelector('svg');
    expect(svg, 'der Knopf trägt eine Ikone').not.toBeNull();
    return svg!.innerHTML;
  }

  it.each([1366, 1024])(
    'bei %i px: „Ton bereit" ohne Marker, „Ton stumm" mit anderer Form und Wort',
    async (px) => {
      setzeViewportBreite(px);
      stubAudioReady();
      stubNotification('default');
      renderAlarm();

      const bereit = await screen.findByRole('button', { name: 'Alarmton stummschalten' });
      await waitFor(() => expect(bereit).toHaveAttribute('aria-pressed', 'false'));
      expect(marker(bereit)).toHaveLength(0);
      const formBereit = ikone(bereit);

      await userEvent.click(bereit);
      const stumm = screen.getByRole('button', { name: 'Alarmton einschalten' });
      // Zwei Kanäle ohne Farbe: die Form wechselt, das Wort steht auf jeder Breite.
      expect(ikone(stumm)).not.toBe(formBereit);
      expect(stumm).toHaveTextContent('Ton stumm');
      expect(marker(stumm)).toHaveLength(0);
    },
  );

  it('auf dem Handschirm: Marke und Menüeintrag „Ton" ohne Marker', async () => {
    stubAudioReady();
    stubNotification('granted');
    setzeViewportBreite(390);
    renderAlarm();

    const ziel = await screen.findByRole('button', { name: /^Alarmzentrale:/ });
    await waitFor(() => expect(ziel).toHaveTextContent('Ton bereit'));
    expect(marker(ziel)).toHaveLength(0);

    await userEvent.click(ziel);
    const menue = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement;
    expect(menue, 'das Menü muss offen sein').not.toBeNull();
    const ton = within(menue).getByRole('menuitem', { name: /stummschalten/ });
    expect(marker(ton)).toHaveLength(0);
  });
});

/**
 * Führungs-Tablet zwischen `md` und `xl`: zwei Knöpfe, der RUHEZUSTAND nur als Ikone, eine
 * STÖRUNG nennt ihr Wort weiter. Beide Hälften als Paar.
 */
describe('AlarmZentrale auf dem Führungs-Tablet (1024 px)', () => {
  beforeEach(() => setzeViewportBreite(1024));

  it('Ruhezustand: zwei Ziele, ohne Wort, Zustand im Namen bzw. Druckzustand', async () => {
    stubAudioReady();
    stubNotification('default');
    renderAlarm();
    const ton = await screen.findByRole('button', { name: 'Alarmton stummschalten' });
    await waitFor(() => expect(ton).toHaveAttribute('aria-pressed', 'false'));
    expect(ton).not.toHaveTextContent('Ton bereit');
    const desktop = screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: aus' });
    expect(desktop).not.toHaveTextContent('Desktop aus');
    expect(screen.queryByRole('button', { name: /^Alarmzentrale:/ })).toBeNull();
  });

  it('Störung: „Ton stumm" und „Desktop blockiert" behalten ihr Wort', async () => {
    stubAudioReady();
    stubNotification('denied');
    renderAlarm();
    expect(
      screen.getByRole('button', { name: 'Desktop-Benachrichtigungen: blockiert' }),
    ).toHaveTextContent('Desktop blockiert');
    await userEvent.click(await screen.findByRole('button', { name: 'Alarmton stummschalten' }));
    expect(screen.getByRole('button', { name: 'Alarmton einschalten' })).toHaveTextContent(
      'Ton stumm',
    );
  });
});

/** LFH-692 (Spec `zeiteingabe`, „Zeit in Texten“): Browser auf UTC, Einsatz auf Europe/Berlin. */
describe('AlarmZentrale — Uhrzeit der Ablösung in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('13:30 UTC erscheint im Hinweis als 15:30', async () => {
    render(
      <AntApp>
        <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
          <MemoryRouter initialEntries={['/einsaetze/1/start']}>
            <Routes>
              <Route path="/einsaetze/:id/*" element={<AlarmTestRoute mitSteuerung={false} />} />
            </Routes>
          </MemoryRouter>
        </AnzeigeKonventionenProvider>
      </AntApp>,
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:abloesung-alarm', {
          detail: {
            abloesung_id: 9,
            art: 'faellig',
            titel: 'Ablösung fällig: Florian 1',
            faellig_at: '2026-09-22 13:30:00',
          },
        }),
      );
    });
    expect(await screen.findByText('Ablösung fällig: Florian 1, 15:30')).toBeInTheDocument();
  });
});
