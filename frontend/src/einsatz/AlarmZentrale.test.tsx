import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App as AntApp } from 'antd';
import { StrictMode, useState } from 'react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useParams } from 'react-router';
import AlarmZentrale, { sammelWortStil } from './AlarmZentrale';
import { istAlarmGemutet } from '../alarm/alarmTon';
import { offeneDesktopAlarme, schliesseAlleDesktopAlarme } from '../alarm/desktopAlarm';
import { setzeViewportBreite, setzeZeigerGrob, VIEWPORT_STANDARD } from '../test/viewport';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { farbenDunkel, rahmenFarben } from '../theme/tokens';
import { http, HttpResponse } from 'msw';
import type {
  BenachrichtigungAnzeige,
  BenachrichtigungArt,
  BenachrichtigungBezugTyp,
} from '../api/types';
import { BENACHRICHTIGUNG_ARTEN } from '../alarm/benachrichtigungKatalog';
import { BENACHRICHTIGUNG_WINDOW_EVENT } from '../live/benachrichtigungListener';
import { server } from '../test/server';

/**
 * Was der Server zu `GET /api/benachrichtigungen/{id}` liefert. Seit LLH-1209 kommen Sofortmeldung,
 * überfälliger Auftrag, Erinnerung und Ablösung nur noch als Benachrichtigung; Titel, Detailzeile
 * und Pfad bildet der Server (`src/benachrichtigung/text.rs`).
 */
const bekannt = new Map<number, BenachrichtigungAnzeige>();
/**
 * Was `GET /api/einsaetze/{e}/meldungen/{id}` liefert (LLH-1052): Absender und Wortlaut holt die
 * Zentrale über die Meldung selbst. Ohne Eintrag 404, dann bleibt der Text des Servers.
 */
const meldungen = new Map<number, { absender: string; inhalt: string }>();
beforeEach(() => {
  bekannt.clear();
  meldungen.clear();
  server.use(
    http.get('/api/benachrichtigungen/:id', ({ params }) => {
      const b = bekannt.get(Number(params.id));
      return b
        ? HttpResponse.json(b)
        : HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 });
    }),
    http.get('/api/einsaetze/:einsatzId/meldungen/:id', ({ params }) => {
      const m = meldungen.get(Number(params.id));
      return m
        ? HttpResponse.json({ id: Number(params.id), einsatz_id: Number(params.einsatzId), ...m })
        : HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 });
    }),
    http.post(
      '/api/benachrichtigungen/:id/quittieren',
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
});

/** Meldet eine Benachrichtigung, wie der Live-Strom sie an die Zentrale weiterreicht. */
function benachrichtige(
  id: number,
  art: BenachrichtigungArt,
  bezug: [BenachrichtigungBezugTyp, number],
  text: { titel: string; detail?: string; pfad: string },
  einsatz_id = 1,
) {
  const [bezug_typ, bezug_id] = bezug;
  const stufe = BENACHRICHTIGUNG_ARTEN[art].stufe;
  bekannt.set(id, {
    id,
    einsatz_id,
    art,
    stufe,
    bezug_typ,
    bezug_id,
    erstellt_at: '2026-10-14 12:00:00',
    ...text,
  });
  act(() => {
    window.dispatchEvent(
      new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, {
        detail: {
          einsatz_id,
          benachrichtigung_id: id,
          art,
          stufe,
          bezug_typ,
          bezug_id,
          quittiert: false,
        },
      }),
    );
  });
}

/** Sofortmeldung `meldung`, als Benachrichtigung `id` (Vorgabe: dieselbe Zahl). */
function sofortmeldung(meldung: number, { id = meldung, einsatz = 1 } = {}) {
  benachrichtige(
    id,
    'sofortmeldung',
    ['meldung', meldung],
    {
      titel: 'Sofortmeldung eingegangen',
      detail: `Meldung #${meldung}`,
      pfad: `/einsaetze/${einsatz}/meldungen?meldung=${meldung}`,
    },
    einsatz,
  );
}

function auftragUeberfaellig(auftrag: number) {
  benachrichtige(100 + auftrag, 'auftrag_ueberfaellig', ['auftrag', auftrag], {
    titel: 'Auftrag überfällig',
    detail: `Auftrag #${auftrag}`,
    pfad: `/einsaetze/1/auftraege?auftrag=${auftrag}`,
  });
}

function erinnerungFaellig(erinnerung: number) {
  benachrichtige(200 + erinnerung, 'erinnerung_faellig', ['erinnerung', erinnerung], {
    titel: 'Erinnerung fällig',
    pfad: '/einsaetze/1/erinnerungen',
  });
}

function abloesung(schicht: number, art: 'abloesung_vorwarnung' | 'abloesung_faellig') {
  benachrichtige(
    300 + schicht * 2 + (art === 'abloesung_faellig' ? 1 : 0),
    art,
    ['abloesung', schicht],
    {
      titel: art === 'abloesung_faellig' ? 'Ablösung fällig' : 'Ablösung steht an',
      detail: `Florian ${schicht}, 15:30`,
      pfad: '/einsaetze/1/abloesung',
    },
  );
}

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

  it('zeigt eine Sofortmeldung mit dem Text des Servers und „Öffnen“', async () => {
    renderAlarm();
    sofortmeldung(3);
    await waitFor(() => expect(screen.getByText('Sofortmeldung eingegangen')).toBeInTheDocument());
    expect(screen.getByText('Meldung #3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Öffnen' })).toBeInTheDocument();
    expect(screen.queryByText(/bitte sichten/i)).not.toBeInTheDocument();
  });

  it('nennt Absender und Wortlautanfang der Sofortmeldung, den ganzen Wortlaut im title (LLH-1052)', async () => {
    const wortlaut =
      'Kellerabgang Mühlbachweg 34: eine schwer verletzte Person geborgen, Transport in die UHS ' +
      'Turnhalle. Zweite Person wird noch vermisst, Suche mit Wärmebildkamera läuft im Keller.';
    meldungen.set(3, { absender: 'Rettungsstaffel', inhalt: wortlaut });
    renderAlarm();
    sofortmeldung(3);
    const titel = await screen.findByText('Sofortmeldung · Rettungsstaffel');
    const notice = titel.closest<HTMLElement>('.ant-notification-notice')!;
    const anfang = within(notice).getByText(/^Kellerabgang Mühlbachweg 34: .* …$/);
    expect(Array.from(anfang.textContent ?? '').length).toBeLessThanOrEqual(120);
    expect(anfang).toHaveAttribute('title', wortlaut);
    // Der Inhalt ersetzt die Detailzeile des Servers.
    expect(within(notice).queryByText('Meldung #3')).not.toBeInTheDocument();
  });

  it('„Öffnen“ springt zur Meldung und hebt sie über ?meldung= hervor', async () => {
    meldungen.set(3, { absender: 'Rettungsstaffel', inhalt: 'Kellerabgang Mühlbachweg 34' });
    renderAlarm({ initialEntry: '/einsaetze/1/etb' });
    sofortmeldung(3);
    await screen.findByText('Sofortmeldung · Rettungsstaffel');
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/meldungen?meldung=3');
  });

  it('ohne Text des Servers springt der Ersatz ebenfalls zur Meldung', async () => {
    meldungen.set(3, { absender: 'Rettungsstaffel', inhalt: 'Kellerabgang Mühlbachweg 34' });
    server.use(
      http.get('/api/benachrichtigungen/:id', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderAlarm({ initialEntry: '/einsaetze/1/etb' });
    sofortmeldung(3);
    await screen.findByText('Sofortmeldung · Rettungsstaffel');
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/meldungen?meldung=3');
  });

  it('zeigt eine fällige Erinnerung ohne Detailzeile', async () => {
    renderAlarm();
    erinnerungFaellig(5);
    await waitFor(() => expect(screen.getByText('Erinnerung fällig')).toBeInTheDocument());
    // LFH-1078: der Titel sagt alles, kein Bittsatz darunter.
    const toast = screen
      .getByText('Erinnerung fällig')
      .closest<HTMLElement>('.ant-notification-notice')!;
    expect(toast.querySelector('.ant-notification-notice-description')).toBeNull();
    expect(within(toast).getByRole('button', { name: 'Öffnen' })).toBeInTheDocument();
  });

  it('zeigt einen überfälligen Auftrag und springt zum Auftrag', async () => {
    renderAlarm();
    auftragUeberfaellig(12);
    await waitFor(() => expect(screen.getByText('Auftrag überfällig')).toBeInTheDocument());
    expect(screen.getByText('Auftrag #12')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege?auftrag=12');
  });

  it('globaler Mute-Toggle persistiert in localStorage', async () => {
    stubAudioReady();
    renderAlarm();
    expect(await screen.findByText('Ton bereit')).toBeInTheDocument();
    expect(istAlarmGemutet()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Ton bereit – stummschalten' }));
    expect(istAlarmGemutet()).toBe(true);
    expect(screen.getByText('Ton stumm')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ton stumm – einschalten' }));
    expect(istAlarmGemutet()).toBe(false);
  });

  it('zeigt den Benachrichtigungs-Status dauerhaft und aktiviert aus der User-Geste', async () => {
    const NotificationMock = stubNotification('default');
    renderAlarm();
    const aus = screen.getByRole('button', { name: 'Benachrichtigung aus – aktivieren' });
    expect(aus).toHaveTextContent('Benachrichtigung aus');
    await userEvent.click(aus);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Benachrichtigung erlaubt' })).toHaveTextContent(
        'Benachrichtigung erlaubt',
      );
    });
    expect(NotificationMock.requestPermission).toHaveBeenCalledOnce();
  });

  it('zeigt Browser-Blockade dauerhaft an', () => {
    stubNotification('denied');
    renderAlarm();
    const knopf = screen.getByRole('button', { name: 'Benachrichtigung blockiert' });
    expect(knopf).toHaveTextContent('Benachrichtigung blockiert');
    expect(knopf).toHaveStyle({ color: farbenDunkel.achtung });
  });

  it.each(['default', 'granted', 'denied', 'unsupported'] as const)(
    'Benachrichtigung %s: der sichtbare Zustand steht wortgleich vorn im Namen (WCAG 2.5.3)',
    (permission) => {
      if (permission === 'unsupported') Reflect.deleteProperty(window, 'Notification');
      else stubNotification(permission);
      renderAlarm();
      const knopf = screen.getByRole('button', { name: /^Benachrichtigung / });
      expect(knopf.textContent).toMatch(/^Benachrichtigung /);
      expect(knopf.getAttribute('aria-label')!.startsWith(knopf.textContent!)).toBe(true);
    },
  );

  it('bündelt beim vierten Sofort-Ereignis die drei vorherigen und behält das neueste einzeln', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    for (let meldung = 1; meldung <= 4; meldung += 1) sofortmeldung(meldung);

    expect(await screen.findByText('3 weitere Sofortmeldungen')).toBeInTheDocument();
    // LFH-1078: Zahl und Art im Titel, das Ziel am Knopf — kein Bittsatz darunter.
    const sammel = screen
      .getByText('3 weitere Sofortmeldungen')
      .closest<HTMLElement>('.ant-notification-notice')!;
    expect(sammel.querySelector('.ant-notification-notice-description')).toBeNull();
    await waitFor(() => {
      expect(document.querySelectorAll('.ant-notification-notice').length).toBeLessThanOrEqual(3);
    });
    expect(screen.getAllByText('Sofortmeldung eingegangen')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Zu Meldungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/meldungen');
  });

  it('räumt beim Einsatzwechsel und Unmount nur die eigenen langlebigen Toasts ab', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start', mitSteuerung: true, strictMode: true });
    for (let meldung = 1; meldung <= 4; meldung += 1) sofortmeldung(meldung);
    expect(await screen.findByText('3 weitere Sofortmeldungen')).toBeInTheDocument();
    expect(await screen.findByText('Sofortmeldung eingegangen')).toBeInTheDocument();
    expect(screen.getByText('3 weitere Sofortmeldungen')).toBeInTheDocument();
    const alteSammelAktion = screen.getByRole('button', { name: 'Zu Meldungen' });

    await userEvent.click(screen.getByRole('button', { name: 'Fremde Notification öffnen' }));
    expect(await screen.findByText('Fremde Notification')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Einsatz wechseln' }));

    // Selbst während antd die alte Notice ausblendet, darf ihre Aktion nicht zur Route des
    // vorherigen Einsatzes springen. Seit antd 6.6.6 trägt die ausblendende Notice
    // `pointer-events: none`; erreichbar bleibt ihr Knopf über die Tastatur.
    alteSammelAktion.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/2/start');
    await warteBisNotificationWeg('Sofortmeldung eingegangen');
    await warteBisNotificationWeg('3 weitere Sofortmeldungen');
    expect(screen.getByText('Fremde Notification')).toBeInTheDocument();
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/2/start');

    sofortmeldung(4, { id: 14, einsatz: 2 });
    expect(await screen.findByText('Sofortmeldung eingegangen')).toBeInTheDocument();
    expect(screen.queryByText('3 weitere Sofortmeldungen')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/2/meldungen');
    await warteBisNotificationWeg('Sofortmeldung eingegangen');

    sofortmeldung(4, { id: 24, einsatz: 2 });
    expect(await screen.findByText('Sofortmeldung eingegangen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alarm-Zentrale ausblenden' }));
    await warteBisNotificationWeg('Sofortmeldung eingegangen');
    expect(screen.getByText('Fremde Notification')).toBeInTheDocument();
  });

  it('bündelt vier Aufträge mit dem korrekten Auftrags-Ziel', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    for (let id = 1; id <= 4; id += 1) {
      auftragUeberfaellig(id);
      await screen.findByText(`Auftrag #${id}`);
    }

    expect(await screen.findByText('3 weitere überfällige Aufträge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Meldungen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Erinnerungen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Aufträgen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege');
  });

  it('bündelt vier Erinnerungen mit dem korrekten Erinnerungs-Ziel', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    for (let id = 1; id <= 4; id += 1) erinnerungFaellig(id);

    expect(await screen.findByText('3 weitere fällige Erinnerungen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Meldungen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zu Aufträgen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Erinnerungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/erinnerungen');
  });

  it('zeigt einen Ablösungs-Hinweis mit Einheit und Uhrzeit und springt zur Ablösung (LFH-635)', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    abloesung(1, 'abloesung_faellig');
    expect(await screen.findByText('Ablösung fällig')).toBeInTheDocument();
    expect(screen.getByText('Florian 1, 15:30')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/abloesung');
  });

  it('Ablösung: Vorwarnung und Fälligkeit sind zwei Hinweise, die Wiederholung derselben keiner', async () => {
    renderAlarm();
    abloesung(9, 'abloesung_vorwarnung');
    abloesung(9, 'abloesung_faellig');
    expect(await screen.findByText('Ablösung steht an')).toBeInTheDocument();
    expect(await screen.findByText('Ablösung fällig')).toBeInTheDocument();
    abloesung(9, 'abloesung_faellig');
    await act(async () => {});
    expect(screen.getAllByText('Ablösung fällig')).toHaveLength(1);
  });

  it('bündelt vier Ablösungen mit dem Ablösungs-Ziel — dasselbe Budget wie alle Quellen', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    for (let id = 1; id <= 4; id += 1) abloesung(id, 'abloesung_faellig');
    expect(await screen.findByText('3 weitere Ablösungen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Ablösungen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/abloesung');
  });

  it('bietet bei gemischter Bündelung getrennte Aktionen nur für betroffene Module', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    sofortmeldung(1);
    await screen.findByText('Meldung #1');
    auftragUeberfaellig(2);
    await screen.findByText('Auftrag #2');
    erinnerungFaellig(3);
    await screen.findByText('Erinnerung fällig');
    sofortmeldung(4);

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
    for (let id = 1; id <= 3; id += 1) {
      sofortmeldung(id);
      await screen.findByText(`Meldung #${id}`);
    }
    act(() =>
      unwetter({
        schluessel: 'schwer|DAUERREGEN',
        titel: 'Unwetterwarnung',
        beschreibung: 'Dauerregen, seit 08:00 · bis 20:00',
      }),
    );
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
    act(() => unwetter(detail));
    for (let id = 1; id <= 3; id += 1) {
      sofortmeldung(id);
      await screen.findByText(`Meldung #${id}`);
    }
    expect(await screen.findByText('3 weitere Alarme')).toBeInTheDocument();
    await warteBisNotificationWeg('Unwetterwarnung');
    act(() => unwetter({ ...detail, beschreibung: 'Dauerregen, seit 15:00 · bis 23:00' }));
    expect(await screen.findByText('Dauerregen, seit 15:00 · bis 23:00')).toBeInTheDocument();
  });

  it('die Zusammenfassung bietet den Weg zu Wetter & Pegel, wenn ein Unwetter darin steckt', async () => {
    renderAlarm({ initialEntry: '/einsaetze/1/start' });
    act(() =>
      unwetter({
        schluessel: 'schwer|DAUERREGEN',
        titel: 'Unwetterwarnung',
        beschreibung: 'Dauerregen, seit 08:00 · bis 20:00',
      }),
    );
    for (let id = 1; id <= 3; id += 1) {
      sofortmeldung(id);
      await screen.findByText(`Meldung #${id}`);
    }
    expect(await screen.findByText('3 weitere Alarme')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zu Wetter & Pegel' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/wetter-pegel');
  });
});

/**
 * Die Kopfzeile auf dem Handschirm: zwei beschriftete Ziele passen auf 390 px nicht (180 px
 * verfügbar, 286 nötig) und brächen um. Die Beschriftung darf nicht zum Icon werden, deshalb
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
    expect(screen.queryByRole('button', { name: 'Benachrichtigung blockiert' })).toBeNull();
    // Über ein MUSTER über alle drei Wortlaute: `tonStatus` dreht erst einen Microtask später auf
    // `bereit`, ein Literal träfe den Knopf in diesem Moment nicht und die Zeile belegte nichts.
    expect(screen.queryByRole('button', { name: /^Ton / })).toBeNull();

    // An ihrer Stelle steht genau EINES, das den Zustand benennt. `findBy…`, weil das Muster schon
    // greift, bevor die Tonprüfung durch ist.
    const ziel = await screen.findByRole('button', { name: /^Alarmzentrale:/ });
    await waitFor(() => expect(ziel).toHaveTextContent('Benachrichtigung blockiert'));
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
    // Kein antd-Iconname im zugänglichen Namen (antds Menü hängt kein `aria-hidden` davor).
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

    expect(screen.getByRole('button', { name: 'Benachrichtigung blockiert' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Alarmzentrale:/ })).toBeNull();
  });
});

/**
 * LFH-513: Der gesunde Ton-Zustand trägt keinen Marker. Ein roter Punkt an „Ton bereit" verbrauchte
 * die Alarmfarbe für eine Nichtmeldung; die Störung trägt ihre Form (durchgestrichene Glocke) und
 * ihr Wort, das genügt WCAG 1.4.1 ohne Farbe. Mutationsprobe: den `<Badge dot status="error">` um
 * die gesunde Glocke zurücklegen → die Marker-Aussagen hier werden rot.
 */
describe('AlarmZentrale: Ton-Icon ohne Marker im Ruhezustand (LFH-513)', () => {
  afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

  /** Jeder antd-Badge-Marker, gleich welcher Status — nicht nur der rote. */
  function marker(wurzel: HTMLElement) {
    return wurzel.querySelectorAll('.ant-badge, .ant-badge-dot, .ant-badge-status-dot');
  }

  function icon(knopf: HTMLElement): string {
    const svg = knopf.querySelector('svg');
    expect(svg, 'der Knopf trägt ein Icon').not.toBeNull();
    return svg!.innerHTML;
  }

  it.each([1366, 1024])(
    'bei %i px: „Ton bereit" ohne Marker, „Ton stumm" mit anderer Form und Wort',
    async (px) => {
      setzeViewportBreite(px);
      stubAudioReady();
      stubNotification('default');
      renderAlarm();

      const bereit = await screen.findByRole('button', { name: 'Ton bereit – stummschalten' });
      await waitFor(() => expect(bereit).toHaveAttribute('aria-pressed', 'false'));
      expect(marker(bereit)).toHaveLength(0);
      const formBereit = icon(bereit);

      await userEvent.click(bereit);
      const stumm = screen.getByRole('button', { name: 'Ton stumm – einschalten' });
      // Zwei Kanäle ohne Farbe: die Form wechselt, das Wort steht auf jeder Breite.
      expect(icon(stumm)).not.toBe(formBereit);
      expect(stumm).toHaveTextContent('Ton stumm');
      // Das sichtbare Wort steht vorn im Namen: Spracheingabe trifft den Knopf (WCAG 2.5.3).
      expect(stumm.getAttribute('aria-label')).toMatch(new RegExp(`^${stumm.textContent} – `));
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
 * LLH-1158: Ab `xl` hält das Ton-Wort die Breite seines längsten Wortlauts. Den Platz trägt
 * erzeugter Inhalt aus `data-platz` (`components/Kopfleiste.css`); ob er die Breite wirklich
 * hält, misst `e2e/kopfhoehe-tonpruefung.spec.ts`. Hier nur die Verdrahtung: jeder Zustand nennt
 * denselben Platz, und der Text des Knopfs bleibt das sichtbare Wort.
 */
describe('AlarmZentrale: das Ton-Wort hält seinen Platz (LLH-1158)', () => {
  afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

  it('1366 px: „Ton bereit“ und „Ton stumm“ stehen im Platz von „Ton wird geprüft“', async () => {
    setzeViewportBreite(1366);
    stubAudioReady();
    stubNotification('default');
    renderAlarm();

    const bereit = await screen.findByRole('button', { name: 'Ton bereit – stummschalten' });
    await waitFor(() => expect(bereit).toHaveAttribute('aria-pressed', 'false'));
    const wort = bereit.querySelector('.kopf-wort-platz');
    expect(wort).toHaveAttribute('data-platz', 'Ton wird geprüft');
    expect(bereit.textContent).toBe('Ton bereit');

    await userEvent.click(bereit);
    const stumm = screen.getByRole('button', { name: 'Ton stumm – einschalten' });
    expect(stumm.querySelector('.kopf-wort-platz')).toHaveAttribute(
      'data-platz',
      'Ton wird geprüft',
    );
    expect(stumm.textContent).toBe('Ton stumm');
  });

  it('1024 px: eine Störung steht ohne Platz, die Prüfung zeigt dort kein Wort (LFH-637)', async () => {
    setzeViewportBreite(1024);
    stubAudioReady();
    stubNotification('default');
    renderAlarm();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Ton bereit – stummschalten' }),
    );
    const stumm = screen.getByRole('button', { name: 'Ton stumm – einschalten' });
    expect(stumm.querySelector('.kopf-wort-platz')).toHaveAttribute('data-platz', '');
  });

  // LLH-1232: In `handschuh` ist der Kopf unter `xl` ohnehin zweizeilig; das Wort mit Platz hält
  // ihn über Prüfung, „Ton bereit“ und „Ton blockiert“ gleich hoch.
  it('1140 px in handschuh: auch der Ruhezustand steht mit Wort im Platz (LLH-1232)', async () => {
    setzeViewportBreite(1140);
    localStorage.setItem('lifeline-hub.dichte', 'handschuh');
    stubAudioReady();
    stubNotification('default');
    try {
      render(
        <ThemeModeProvider>
          <AntApp>
            <MemoryRouter initialEntries={['/einsaetze/1/meldungen']}>
              <Routes>
                <Route path="/einsaetze/:id/*" element={<AlarmTestRoute mitSteuerung={false} />} />
              </Routes>
            </MemoryRouter>
          </AntApp>
        </ThemeModeProvider>,
      );

      const bereit = await screen.findByRole('button', { name: 'Ton bereit – stummschalten' });
      expect(bereit.querySelector('.kopf-wort-platz')).toHaveAttribute(
        'data-platz',
        'Ton wird geprüft',
      );
      expect(bereit.textContent).toBe('Ton bereit');
      // Die Benachrichtigung wechselt beim Start nicht von selbst und bleibt Icon (LFH-637).
      expect(
        screen.getByRole('button', { name: 'Benachrichtigung aus – aktivieren' }).textContent,
      ).toBe('');
    } finally {
      localStorage.removeItem('lifeline-hub.dichte');
    }
  });
});

/**
 * Führungs-Tablet zwischen `md` und `xl`: zwei Knöpfe, der RUHEZUSTAND nur als Icon, eine
 * STÖRUNG nennt ihr Wort weiter. Beide Hälften als Paar.
 */
describe('AlarmZentrale auf dem Führungs-Tablet (1024 px)', () => {
  beforeEach(() => setzeViewportBreite(1024));

  it('Ruhezustand: zwei Ziele, ohne Wort, Zustand im Namen bzw. Druckzustand', async () => {
    stubAudioReady();
    stubNotification('default');
    renderAlarm();
    const ton = await screen.findByRole('button', { name: 'Ton bereit – stummschalten' });
    await waitFor(() => expect(ton).toHaveAttribute('aria-pressed', 'false'));
    expect(ton).not.toHaveTextContent('Ton bereit');
    const desktop = screen.getByRole('button', { name: 'Benachrichtigung aus – aktivieren' });
    expect(desktop).not.toHaveTextContent('Benachrichtigung aus');
    expect(screen.queryByRole('button', { name: /^Alarmzentrale:/ })).toBeNull();
  });

  it('Störung: „Ton stumm" und „Benachrichtigung blockiert" behalten ihr Wort', async () => {
    stubAudioReady();
    stubNotification('denied');
    renderAlarm();
    expect(screen.getByRole('button', { name: 'Benachrichtigung blockiert' })).toHaveTextContent(
      'Benachrichtigung blockiert',
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ton bereit – stummschalten' }),
    );
    expect(screen.getByRole('button', { name: 'Ton stumm – einschalten' })).toHaveTextContent(
      'Ton stumm',
    );
  });
});

/**
 * LFH-950: Auf dem Führungs-Tablet mit Finger bündelt die Zentrale wie auf dem Handschirm. Ein
 * Tooltip erschiene erst nach dem Tipp, und der Tipp auf die Glocke schaltete sofort stumm.
 */
describe('AlarmZentrale auf dem Tablet mit Finger (LFH-950)', () => {
  afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

  it.each([820, 1024, 1180])(
    'bei %i px: EIN Ziel, der Tipp öffnet das Menü und schaltet nicht stumm',
    async (px) => {
      setzeViewportBreite(px);
      setzeZeigerGrob(true);
      stubAudioReady();
      stubNotification('default');
      renderAlarm();

      expect(screen.queryByRole('button', { name: /^Ton / })).toBeNull();
      const ziel = await screen.findByRole('button', { name: 'Alarmzentrale: Ton bereit' });
      // Ruhezustand ohne Wort, wie die breite Bauform zwischen md und xl (LFH-637).
      expect(ziel).toHaveTextContent(/^$/);

      await userEvent.click(ziel);
      expect(istAlarmGemutet()).toBe(false);
      const menue = document.querySelector(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      ) as HTMLElement;
      expect(menue, 'das Menü muss offen sein').not.toBeNull();
      const eintraege = within(menue).getAllByRole('menuitem');
      // Handlung UND Zustand als Satz, ohne Tooltip lesbar.
      expect(eintraege.map((e) => e.textContent)).toEqual([
        'Benachrichtigungen sind aus – aktivieren',
        'Alarmton ist bereit – stummschalten',
      ]);
      await userEvent.click(eintraege[1]);
      expect(istAlarmGemutet()).toBe(true);
      await waitFor(() => expect(ziel).toHaveTextContent('Ton stumm'));
    },
  );

  it('mit Maus bleiben es bei 1024 px zwei Knöpfe', async () => {
    setzeViewportBreite(1024);
    setzeZeigerGrob(false);
    stubAudioReady();
    stubNotification('default');
    renderAlarm();
    expect(await screen.findByRole('button', { name: /^Ton / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Alarmzentrale:/ })).toBeNull();
  });

  it('ab xl gilt auch mit Finger die breite Bauform', async () => {
    setzeViewportBreite(1366);
    setzeZeigerGrob(true);
    stubAudioReady();
    stubNotification('default');
    renderAlarm();
    expect(await screen.findByRole('button', { name: /^Ton / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Alarmzentrale:/ })).toBeNull();
  });
});

/** LFH-950: Kein „Desktop" mehr als Zustandswort; fehlt die API, keine Warnfarbe. */
describe('AlarmZentrale: Wortwahl der Benachrichtigungen (LFH-950)', () => {
  afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

  it.each([
    [390, 'default'],
    [390, 'denied'],
    [820, 'denied'],
    [1366, 'default'],
    [1366, 'granted'],
    [1366, 'denied'],
  ] as const)('bei %i px und %s steht nirgends „Desktop"', async (px, permission) => {
    setzeViewportBreite(px);
    stubAudioReady();
    stubNotification(permission);
    const { container } = renderAlarm();
    await waitFor(() => expect(container.textContent).toMatch(/Ton bereit|Benachrichtigung/));
    expect(container.textContent).not.toMatch(/Desktop/);
    for (const knopf of screen.getAllByRole('button')) {
      expect(knopf.getAttribute('aria-label') ?? '').not.toMatch(/Desktop/);
    }
  });

  it('ohne Notification-API: „nicht verfügbar", ohne Warnfarbe und ohne Aktion', async () => {
    setzeViewportBreite(1366);
    stubAudioReady();
    Reflect.deleteProperty(window, 'Notification');
    renderAlarm();
    const knopf = screen.getByRole('button', { name: 'Benachrichtigung nicht verfügbar' });
    expect(knopf).toHaveTextContent('Benachrichtigung nicht verfügbar');
    expect(knopf).toHaveStyle({ color: rahmenFarben.gedaempft });
    expect(knopf).toHaveAttribute('aria-disabled', 'true');
  });

  it('auf dem Handschirm nennt die Marke bei abgeschalteter Benachrichtigung den Ton', async () => {
    setzeViewportBreite(390);
    stubAudioReady();
    stubNotification('default');
    renderAlarm();
    const ziel = await screen.findByRole('button', { name: /^Alarmzentrale:/ });
    await waitFor(() => expect(ziel).toHaveTextContent('Ton bereit'));
  });
});

/**
 * LFH-951: Desktop-Meldungen tragen einen fachlichen `tag` und werden geschlossen, sobald die
 * App den Alarm wieder selbst trägt.
 */
describe('AlarmZentrale: Desktop-Meldungen schließen (LFH-951)', () => {
  type Meldung = {
    titel: string;
    body: string | undefined;
    tag: string;
    onclose: (() => void) | null;
    onclick: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
  };

  function stubMeldungen() {
    const meldungen: Meldung[] = [];
    const Ctor = vi.fn(function (titel: string, opts?: NotificationOptions) {
      const m: Meldung = {
        titel,
        body: opts?.body,
        tag: opts?.tag ?? '',
        onclose: null,
        onclick: null,
        close: vi.fn(() => m.onclose?.()),
      };
      meldungen.push(m);
      return m;
    }) as unknown as typeof Notification & { permission: NotificationPermission };
    Ctor.permission = 'granted';
    vi.stubGlobal('Notification', Ctor);
    return { Ctor, meldungen };
  }

  function setzeHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  }

  beforeEach(() => setzeViewportBreite(1366));
  afterEach(() => {
    schliesseAlleDesktopAlarme();
    setzeHidden(false);
    setzeViewportBreite(VIEWPORT_STANDARD);
  });

  it('wird der Tab wieder sichtbar, schließen sich die offenen Desktop-Meldungen', async () => {
    stubAudioReady();
    const { Ctor, meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    sofortmeldung(3);
    await waitFor(() =>
      expect(Ctor).toHaveBeenCalledWith('Sofortmeldung eingegangen', {
        body: 'Meldung #3',
        tag: '1-b-3',
      }),
    );
    expect(offeneDesktopAlarme()).toBe(1);

    setzeHidden(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(meldungen[0].close).toHaveBeenCalledOnce();
    expect(offeneDesktopAlarme()).toBe(0);
    // Der Toast trägt den Alarm weiter.
    expect(screen.getByText('Sofortmeldung eingegangen')).toBeInTheDocument();
  });

  it('die OS-Meldung nennt Absender und Wortlaut, ihr Klick springt zur Meldung (LLH-1052)', async () => {
    stubAudioReady();
    const { meldungen: os } = stubMeldungen();
    setzeHidden(true);
    meldungen.set(3, { absender: 'Rettungsstaffel', inhalt: 'Kellerabgang Mühlbachweg 34' });
    renderAlarm({ initialEntry: '/einsaetze/1/etb' });
    sofortmeldung(3);
    await waitFor(() => expect(os).toHaveLength(1));
    expect([os[0].titel, os[0].body]).toEqual([
      'Sofortmeldung · Rettungsstaffel',
      'Kellerabgang Mühlbachweg 34',
    ]);
    act(() => os[0].onclick?.());
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/meldungen?meldung=3');
  });

  it('dieselbe Benachrichtigung erneut (Replay) zeigt keine zweite Desktop-Meldung', async () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    sofortmeldung(3);
    await waitFor(() => expect(meldungen).toHaveLength(1));
    sofortmeldung(3);
    await act(async () => {});
    expect(meldungen).toHaveLength(1);
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('jede Quelle trägt ihren fachlichen tag', async () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    erinnerungFaellig(5);
    await waitFor(() => expect(meldungen).toHaveLength(1));
    auftragUeberfaellig(12);
    await waitFor(() => expect(meldungen).toHaveLength(2));
    abloesung(9, 'abloesung_vorwarnung');
    await waitFor(() => expect(meldungen).toHaveLength(3));
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:unwetter-alarm', { detail: { schluessel: 'sturm-2' } }),
      );
    });
    // Benachrichtigungen unter ihrer Kennung, der Unwetterhinweis unter seinem Paar.
    expect(meldungen.map((m) => m.tag)).toEqual([
      '1-b-205',
      '1-b-112',
      '1-b-318',
      '1-unwetter-sturm-2',
    ]);

    // LFH-1078: die OS-Meldung nennt Gegenstand und Zustand, keine Bitte.
    expect(meldungen.map((m) => [m.titel, m.body])).toEqual([
      ['Erinnerung fällig', undefined],
      ['Auftrag überfällig', 'Auftrag #12'],
      ['Ablösung steht an', 'Florian 9, 15:30'],
      ['Unwetterwarnung', 'Unwetterwarnung für den Einsatzort'],
    ]);
  });

  it('eine neue Unwetterwarnung ersetzt die ältere Desktop-Meldung wie den Toast', () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:unwetter-alarm', { detail: { schluessel: 'sturm-2' } }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:unwetter-alarm', { detail: { schluessel: 'gewitter-3' } }),
      );
    });
    expect(meldungen[0].close).toHaveBeenCalled();
    expect(meldungen[1].close).not.toHaveBeenCalled();
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('Öffnen im Toast schließt die zugehörige Desktop-Meldung', async () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    sofortmeldung(3);
    sofortmeldung(4);
    await waitFor(() => expect(meldungen).toHaveLength(2));
    // Sichtbar machen ohne Ereignis: so prüft der Test den Weg über den Toast allein.
    setzeHidden(false);
    const toast = (await screen.findAllByText('Sofortmeldung eingegangen'))[0].closest<HTMLElement>(
      '.ant-notification-notice',
    )!;
    await userEvent.click(within(toast).getByRole('button', { name: 'Öffnen' }));
    expect(meldungen.filter((m) => m.close.mock.calls.length > 0)).toHaveLength(1);
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('Schließen des Toasts (Quittieren) schließt die zugehörige Desktop-Meldung', async () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    sofortmeldung(3);
    sofortmeldung(4);
    await waitFor(() => expect(meldungen).toHaveLength(2));
    setzeHidden(false);
    const toast = (await screen.findAllByText('Sofortmeldung eingegangen'))[0].closest<HTMLElement>(
      '.ant-notification-notice',
    )!;
    const kreuz = toast.querySelector<HTMLElement>('.ant-notification-notice-close');
    expect(kreuz, 'der Toast hat ein Schließkreuz').not.toBeNull();
    await userEvent.click(kreuz!);
    await waitFor(() => expect(offeneDesktopAlarme()).toBe(1));
    expect(meldungen.filter((m) => m.close.mock.calls.length > 0)).toHaveLength(1);
  });

  it('Öffnen schließt genau die Desktop-Meldung seines Toasts, nicht die des Unwetters', async () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('lfh:unwetter-alarm', { detail: { schluessel: 'sturm-1' } }),
      );
    });
    sofortmeldung(3);
    await waitFor(() =>
      expect(meldungen.map((m) => m.tag)).toEqual(['1-unwetter-sturm-1', '1-b-3']),
    );
    setzeHidden(false);
    const toast = (await screen.findByText('Sofortmeldung eingegangen')).closest<HTMLElement>(
      '.ant-notification-notice',
    )!;
    await userEvent.click(within(toast).getByRole('button', { name: 'Öffnen' }));
    expect(meldungen[1].close).toHaveBeenCalledOnce();
    expect(meldungen[0].close).not.toHaveBeenCalled();
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('Schließen der Zusammenfassung schließt die Desktop-Meldungen der gebündelten Alarme', async () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderAlarm();
    for (const id of [1, 2, 3, 4]) {
      sofortmeldung(id);
      await waitFor(() => expect(meldungen).toHaveLength(id));
    }
    setzeHidden(false);
    const sammel = (await screen.findByText('3 weitere Sofortmeldungen')).closest<HTMLElement>(
      '.ant-notification-notice',
    )!;
    await userEvent.click(sammel.querySelector<HTMLElement>('.ant-notification-notice-close')!);
    await waitFor(() => expect(offeneDesktopAlarme()).toBe(1));
    expect(meldungen.filter((m) => m.close.mock.calls.length > 0).map((m) => m.tag)).toEqual([
      '1-b-1',
      '1-b-2',
      '1-b-3',
    ]);
  });

  it('der Unmount der Alarmzentrale schließt alle Desktop-Meldungen', async () => {
    stubAudioReady();
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    const { unmount } = renderAlarm();
    sofortmeldung(3);
    sofortmeldung(4);
    await waitFor(() => expect(meldungen.map((m) => m.tag)).toEqual(['1-b-3', '1-b-4']));
    unmount();
    expect(meldungen.every((m) => m.close.mock.calls.length === 1)).toBe(true);
    expect(offeneDesktopAlarme()).toBe(0);
  });
});

/**
 * LFH-1062: Auf Android gibt es den `Notification`-Konstruktor nicht; die Meldung kommt über den
 * Service Worker, und dessen Klick-Nachricht führt zur Quelle.
 */
describe('AlarmZentrale: Meldungen über den Service Worker (LFH-1062)', () => {
  type SwMeldung = { titel: string; tag: string; data: { id: string; ziel?: string } };

  function stubAndroidMitServiceWorker() {
    const Ctor = vi.fn(function () {
      throw new TypeError('Illegal constructor');
    }) as unknown as typeof Notification & { permission: NotificationPermission };
    Ctor.permission = 'granted';
    vi.stubGlobal('Notification', Ctor);
    const sw: SwMeldung[] = [];
    const hoerer: ((ev: MessageEvent) => void)[] = [];
    const registrierung = {
      showNotification: vi.fn(async (titel: string, opts: NotificationOptions = {}) => {
        sw.push({ titel, tag: opts.tag ?? '', data: opts.data as SwMeldung['data'] });
      }),
      getNotifications: vi.fn(async (filter?: GetNotificationOptions) =>
        sw
          .filter((m) => !filter?.tag || m.tag === filter.tag)
          .map((m) => ({ data: m.data, close: () => sw.splice(sw.indexOf(m), 1) })),
      ),
    };
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0',
      serviceWorker: {
        controller: {
          postMessage: (m: { typ?: string }) => {
            if (m.typ !== 'lfh-alarm-nachfrage') return;
            setTimeout(() => {
              for (const f of hoerer) {
                f(new MessageEvent('message', { data: { typ: 'lfh-alarm-antwort' } }));
              }
            }, 0);
          },
        },
        ready: Promise.resolve(registrierung),
        addEventListener: (typ: string, f: (ev: MessageEvent) => void) => {
          if (typ === 'message') hoerer.push(f);
        },
      },
    });
    const klick = (id: string) => {
      for (const f of hoerer)
        f(new MessageEvent('message', { data: { typ: 'lfh-alarm-klick', id } }));
    };
    return { Ctor, sw, klick };
  }

  function setzeHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  }

  beforeEach(() => setzeViewportBreite(1366));
  afterEach(() => {
    schliesseAlleDesktopAlarme();
    setzeHidden(false);
    vi.unstubAllGlobals();
    setzeViewportBreite(VIEWPORT_STANDARD);
  });

  it('meldet „erlaubt", zeigt die Sofortmeldung als Systemmeldung, und der Tipp führt zur Quelle', async () => {
    stubAudioReady();
    const { Ctor, sw, klick } = stubAndroidMitServiceWorker();
    renderAlarm({ initialEntry: '/einsaetze/1/lage' });
    // Erst die Antwort des Service Workers macht den Weg verfügbar.
    expect(
      await screen.findByRole('button', { name: /^Benachrichtigung erlaubt/ }),
    ).toBeInTheDocument();

    setzeHidden(true);
    sofortmeldung(3);
    await waitFor(() => expect(sw).toHaveLength(1));
    expect(Ctor).not.toHaveBeenCalled();
    expect(sw[0]).toMatchObject({ titel: 'Sofortmeldung eingegangen', tag: '1-b-3' });
    expect(sw[0].data.ziel).toBe(
      new URL('/einsaetze/1/meldungen?meldung=3', window.location.href).href,
    );
    const id = sw[0].data.id;

    // Der Service Worker holt den Tab nach vorn, der räumt ab; dann kommt der Klick.
    setzeHidden(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(sw).toHaveLength(0));
    act(() => klick(id));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/meldungen?meldung=3');
  });
});

describe('AlarmZentrale: Wort der gebündelten Marke (LFH-1108)', () => {
  it('bricht auf dem Handschirm ab 48 px Steuerhöhe auf das längste Wort um, sonst einzeilig', () => {
    expect(sammelWortStil(30, true)).toEqual({});
    for (const hoehe of [48, 72]) {
      expect(sammelWortStil(hoehe, true)).toMatchObject({
        whiteSpace: 'normal',
        width: 'min-content',
      });
      expect(sammelWortStil(hoehe, false)).toEqual({});
    }
  });
});
