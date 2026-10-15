import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BenachrichtigungAnzeige,
  BenachrichtigungArt,
  BenachrichtigungBezugTyp,
  BenachrichtigungEreignis,
} from '../api/types';
import AlarmZentrale from '../einsatz/AlarmZentrale';
import { BENACHRICHTIGUNG_WINDOW_EVENT, meldeNachreichen } from '../live/benachrichtigungListener';
import { beendeHuelle, starteMacHuelle, starteWindowsHuelle } from '../test/huelle';
import { server } from '../test/server';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import { spieleAlarmTon } from './alarmTon';
import { BENACHRICHTIGUNG_ARTEN } from './benachrichtigungKatalog';
import { offeneDesktopAlarme, schliesseAlleDesktopAlarme } from './desktopAlarm';

vi.mock('./alarmTon', async (original) => ({
  ...(await original<typeof import('./alarmTon')>()),
  spieleAlarmTon: vi.fn(),
}));

const PFAD: Partial<Record<BenachrichtigungBezugTyp, (einsatz: number, id: number) => string>> = {
  auftrag: (e, id) => `/einsaetze/${e}/auftraege?auftrag=${id}`,
  befehl: (e, id) => `/einsaetze/${e}/auftraege/befehle/${id}`,
  nachforderung: (e) => `/einsaetze/${e}/nachforderungen`,
  einsatz: (e) => `/einsaetze/${e}`,
};

const TITEL: Partial<Record<BenachrichtigungArt, string>> = {
  auftrag_erteilt: 'Neuer Auftrag',
  auftrag_ueberfaellig: 'Auftrag überfällig',
  befehl: 'Neuer Befehl',
  nachforderung_status: 'Status einer Nachforderung',
};

/** Eine Benachrichtigung, wie der Server sie liest und im Ereignis meldet. */
function benachrichtigung(
  id: number,
  art: BenachrichtigungArt,
  bezug_typ: BenachrichtigungBezugTyp,
  bezug_id: number,
  extra: Partial<BenachrichtigungAnzeige> = {},
): BenachrichtigungAnzeige {
  const einsatz_id = extra.einsatz_id ?? 1;
  return {
    id,
    einsatz_id,
    art,
    stufe: BENACHRICHTIGUNG_ARTEN[art].stufe,
    bezug_typ,
    bezug_id,
    erstellt_at: '2026-10-14 12:05:00',
    titel: TITEL[art] ?? art,
    detail: bezug_typ === 'auftrag' ? `Auftrag #${bezug_id}` : null,
    pfad: PFAD[bezug_typ]?.(einsatz_id, bezug_id) ?? `/einsaetze/${einsatz_id}`,
    ...extra,
  };
}

function ereignisVon(b: BenachrichtigungAnzeige, quittiert = false): BenachrichtigungEreignis {
  return {
    einsatz_id: b.einsatz_id,
    benachrichtigung_id: b.id,
    art: b.art,
    stufe: b.stufe,
    bezug_typ: b.bezug_typ,
    bezug_id: b.bezug_id,
    quittiert,
  };
}

/** Wie `useEinsatzLiveStream` das Live-Ereignis weiterreicht. */
function live(b: BenachrichtigungAnzeige, quittiert = false) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, { detail: ereignisVon(b, quittiert) }),
    );
  });
}

/** Der Server kennt diese Benachrichtigungen; `quittiert` sammelt die Quittungen. */
function serverMit(liste: BenachrichtigungAnzeige[], offen: BenachrichtigungAnzeige[] = []) {
  const quittiert: number[] = [];
  const abgerufen: number[] = [];
  const offeneAbrufe = { anzahl: 0 };
  server.use(
    http.get('/api/benachrichtigungen/:id', ({ params }) => {
      const id = Number(params.id);
      abgerufen.push(id);
      const b = liste.find((x) => x.id === id);
      return b
        ? HttpResponse.json(b)
        : HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 });
    }),
    http.get('/api/benachrichtigungen', () => {
      offeneAbrufe.anzahl += 1;
      return HttpResponse.json(offen);
    }),
    http.post('/api/benachrichtigungen/:id/quittieren', ({ params }) => {
      quittiert.push(Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { quittiert, abgerufen, offeneAbrufe };
}

function Route1() {
  const location = useLocation();
  const navigate = useNavigate();
  const einsatzId = Number(useParams().id);
  return (
    <>
      <button type="button" onClick={() => navigate('/einsaetze/2/start')}>
        Einsatz wechseln
      </button>
      <AlarmZentrale einsatzId={einsatzId} />
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
    </>
  );
}

function renderZentrale() {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={['/einsaetze/1/start']}>
        <Routes>
          <Route path="/einsaetze/:id/*" element={<Route1 />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

async function warteBisNotificationWeg(titel: string) {
  await waitFor(() => {
    for (const el of screen.queryAllByText(titel)) {
      const notice = el.closest<HTMLElement>('.ant-notification-notice');
      if (notice) {
        fireEvent.transitionEnd(notice);
        fireEvent.animationEnd(notice);
      }
    }
    expect(screen.queryByText(titel)).not.toBeInTheDocument();
  });
}

function notice(titel: string): HTMLElement {
  const el = screen.getByText(titel).closest<HTMLElement>('.ant-notification-notice');
  if (!el) throw new Error(`kein Toast „${titel}“`);
  return el;
}

function setzeHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

function stubMeldungen() {
  const meldungen: { close: ReturnType<typeof vi.fn> }[] = [];
  const Ctor = vi.fn(function (this: unknown) {
    const m = { onclose: null as null | (() => void), onclick: null, close: vi.fn() };
    m.close.mockImplementation(() => m.onclose?.());
    meldungen.push(m);
    return m;
  }) as unknown as typeof Notification & { permission: NotificationPermission };
  Ctor.permission = 'granted';
  vi.stubGlobal('Notification', Ctor);
  return { Ctor, meldungen };
}

const ton = vi.mocked(spieleAlarmTon);

beforeEach(() => {
  setzeViewportBreite(1366);
  ton.mockClear();
});

afterEach(() => {
  schliesseAlleDesktopAlarme();
  setzeHidden(false);
  vi.unstubAllGlobals();
  setzeViewportBreite(VIEWPORT_STANDARD);
});

describe('Benachrichtigungszentrale: Text, Ton und Toast (tasks.md 2.1)', () => {
  it('Hinweis, Tab sichtbar: Toast mit Text vom Server, dezenter Ton, keine OS-Meldung', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    serverMit([auftrag]);
    const { Ctor } = stubMeldungen();
    renderZentrale();
    live(auftrag);

    const toast = await screen.findByText('Neuer Auftrag');
    expect(within(notice('Neuer Auftrag')).getByText('Auftrag #12')).toBeInTheDocument();
    expect(toast.closest('.ant-notification-notice-info')).not.toBeNull();
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('Hinweis, Tab verdeckt: zusätzlich die OS-Meldung mit fachlichem tag', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    serverMit([auftrag]);
    const { Ctor } = stubMeldungen();
    setzeHidden(true);
    renderZentrale();
    live(auftrag);

    expect(await screen.findByText('Neuer Auftrag')).toBeInTheDocument();
    expect(Ctor).toHaveBeenCalledExactlyOnceWith('Neuer Auftrag', {
      body: 'Auftrag #12',
      tag: '1-b-40',
    });
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('Alarm, Tab sichtbar: Warn-Toast und Alarmton', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    serverMit([ueberfaellig]);
    const { Ctor } = stubMeldungen();
    renderZentrale();
    live(ueberfaellig);

    const toast = await screen.findByText('Auftrag überfällig');
    expect(toast.closest('.ant-notification-notice-warning')).not.toBeNull();
    expect(ton).toHaveBeenCalledExactlyOnceWith('alarm');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('Alarm, Tab verdeckt: OS-Meldung unter dem tag der Benachrichtigung', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    serverMit([ueberfaellig]);
    const { Ctor } = stubMeldungen();
    setzeHidden(true);
    renderZentrale();
    live(ueberfaellig);

    expect(await screen.findByText('Auftrag überfällig')).toBeInTheDocument();
    expect(Ctor).toHaveBeenCalledExactlyOnceWith('Auftrag überfällig', {
      body: 'Auftrag #7',
      tag: '1-b-41',
    });
    expect(ton).toHaveBeenCalledExactlyOnceWith('alarm');
  });

  it('„Öffnen“ springt zum Bezug und quittiert', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    const s = serverMit([auftrag]);
    renderZentrale();
    live(auftrag);
    await screen.findByText('Neuer Auftrag');

    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege?auftrag=12');
    await waitFor(() => expect(s.quittiert).toEqual([40]));
    // Ein Seitenwechsel im Einsatz holt die offene Liste nicht noch einmal.
    expect(s.offeneAbrufe.anzahl).toBe(1);
  });

  it('dasselbe Ereignis zweimal (Replay): ein Toast, ein Ton, ein Abruf', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    const s = serverMit([auftrag]);
    renderZentrale();
    live(auftrag);
    live(auftrag);
    await screen.findByText('Neuer Auftrag');
    live(auftrag);

    await waitFor(() => expect(ton).toHaveBeenCalledOnce());
    expect(screen.getAllByText('Neuer Auftrag')).toHaveLength(1);
    expect(s.abgerufen).toEqual([40]);
  });

  it('eine fremde oder aufgeräumte Benachrichtigung (404) bleibt still', async () => {
    const s = serverMit([]);
    renderZentrale();
    live(benachrichtigung(99, 'auftrag_erteilt', 'auftrag', 12));
    await waitFor(() => expect(s.abgerufen).toEqual([99]));
    expect(screen.queryByText('Neuer Auftrag')).not.toBeInTheDocument();
    expect(ton).not.toHaveBeenCalled();
  });

  it('eine Benachrichtigung eines anderen Einsatzes erscheint hier nicht', async () => {
    const s = serverMit([]);
    renderZentrale();
    live(benachrichtigung(42, 'auftrag_erteilt', 'auftrag', 12, { einsatz_id: 2 }));
    // Kein Abruf: die Zentrale filtert schon am Ereignis.
    await act(async () => {});
    expect(s.abgerufen).toEqual([]);
  });

  it('ohne Text vom Server (Netzfehler) steht der Name der Art mit Sprung ins Modul', async () => {
    server.use(http.get('/api/benachrichtigungen/:id', () => HttpResponse.error()));
    renderZentrale();
    live(benachrichtigung(43, 'auftrag_ueberfaellig', 'auftrag', 7));

    expect(await screen.findByText('Auftrag überfällig')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('alarm');
  });
});

describe('Desktop-App: native Meldung (tasks.md 5.2)', () => {
  afterEach(beendeHuelle);

  /** Die Hülle samt der Web-API, die das Notification-Plugin dort in jede Seite hängt. */
  function inDerHuelle(start = starteMacHuelle) {
    const invoke = vi.fn().mockResolvedValue(undefined);
    start({ invoke });
    return { invoke, ...stubMeldungen() };
  }

  const NATIVE_MELDUNG = {
    titel: 'Auftrag überfällig',
    text: 'Auftrag #7',
  };

  it('Fenster minimiert: der Alarm kommt als native Meldung, beim Aktivieren steht der Toast mit „Öffnen“ bereit', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    const s = serverMit([ueberfaellig]);
    const { invoke, Ctor } = inDerHuelle();
    setzeHidden(true);
    renderZentrale();
    live(ueberfaellig);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledExactlyOnceWith('benachrichtigung_zeigen', NATIVE_MELDUNG),
    );
    expect(Ctor).not.toHaveBeenCalled();
    expect(ton).toHaveBeenCalledExactlyOnceWith('alarm');

    // Der Klick auf die Meldung holt das Fenster nach vorn (Hülle); die Seite wird sichtbar.
    setzeHidden(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    const oeffnen = within(notice('Auftrag überfällig')).getByRole('button', { name: 'Öffnen' });
    expect(s.quittiert).toEqual([]);
    await userEvent.click(oeffnen);
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege?auftrag=7');
    await waitFor(() => expect(s.quittiert).toEqual([41]));
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('Fenster sichtbar: keine native Meldung, nur Toast und Ton', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    serverMit([ueberfaellig]);
    const { invoke, Ctor } = inDerHuelle();
    renderZentrale();
    live(ueberfaellig);

    expect(await screen.findByText('Auftrag überfällig')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('alarm');
    expect(invoke).not.toHaveBeenCalled();
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('in der Windows-Hülle ebenso über den Command', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    serverMit([ueberfaellig]);
    const { invoke, Ctor } = inDerHuelle(starteWindowsHuelle);
    setzeHidden(true);
    renderZentrale();
    live(ueberfaellig);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledExactlyOnceWith('benachrichtigung_zeigen', NATIVE_MELDUNG),
    );
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('die Kopfleiste nennt die Benachrichtigung in der Hülle erlaubt, wie auch die Web-API steht', async () => {
    // Auf macOS bleibt die Web-API, die das Plugin einhängt, unentschieden.
    const { Ctor } = inDerHuelle();
    Ctor.permission = 'default';
    renderZentrale();
    expect(
      await screen.findByRole('button', { name: 'Benachrichtigung erlaubt' }),
    ).toBeInTheDocument();
  });
});

describe('Quittieren über alle Verbindungen (tasks.md 2.2)', () => {
  it('Zwei Tabs: ✕ im ersten quittiert, das Quittier-Ereignis nimmt den Toast im zweiten weg', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    const s = serverMit([auftrag]);
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderZentrale();
    live(auftrag);
    await screen.findByText('Neuer Auftrag');
    expect(offeneDesktopAlarme()).toBe(1);

    // Erster Tab: ✕ quittiert auf dem Server.
    await userEvent.click(
      within(notice('Neuer Auftrag')).getByRole('button', { name: /close|schließen/i }),
    );
    await waitFor(() => expect(s.quittiert).toEqual([40]));
    expect(meldungen[0].close).toHaveBeenCalled();
  });

  it('Zwei Tabs: im zweiten Tab verschwinden Toast und OS-Meldung auf das Quittier-Ereignis', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    const s = serverMit([auftrag], [auftrag]);
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderZentrale();
    live(auftrag);
    await screen.findByText('Neuer Auftrag');

    live(auftrag, true);
    await warteBisNotificationWeg('Neuer Auftrag');
    expect(meldungen[0].close).toHaveBeenCalled();
    expect(offeneDesktopAlarme()).toBe(0);
    // Dieser Tab quittiert nicht noch einmal, und ein Nachreichen bringt ihn nicht zurück.
    act(() => meldeNachreichen());
    await waitFor(() => expect(s.offeneAbrufe.anzahl).toBe(2));
    expect(screen.queryByText('Neuer Auftrag')).not.toBeInTheDocument();
    expect(s.quittiert).toEqual([]);
  });

  it('das Quittier-Ereignis nimmt eine gebündelte Benachrichtigung aus dem Sammeltoast', async () => {
    const liste = [1, 2, 3, 4].map((n) =>
      benachrichtigung(50 + n, 'auftrag_erteilt', 'auftrag', n),
    );
    serverMit(liste);
    renderZentrale();
    for (const b of liste) {
      live(b);
      await screen.findByText(`Auftrag #${b.bezug_id}`);
    }
    expect(await screen.findByText('3 weitere Hinweise')).toBeInTheDocument();

    live(liste[0], true);
    expect(await screen.findByText('2 weitere Hinweise')).toBeInTheDocument();
  });

  it('Einsatzwechsel räumt die Toasts ab, ohne zu quittieren', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    const s = serverMit([auftrag]);
    renderZentrale();
    live(auftrag);
    await screen.findByText('Neuer Auftrag');

    await userEvent.click(screen.getByRole('button', { name: 'Einsatz wechseln' }));
    await warteBisNotificationWeg('Neuer Auftrag');
    expect(s.quittiert).toEqual([]);
  });
});

describe('Nachreichen (tasks.md 2.3)', () => {
  it('Server-Neustart: nach `lagged` erscheint „Auftrag überfällig“ mit Uhrzeit und einmal dem dezenten Ton', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    const hinweis = benachrichtigung(44, 'auftrag_erteilt', 'auftrag', 8, {
      erstellt_at: '2026-10-14 12:07:00',
    });
    const offen: BenachrichtigungAnzeige[] = [];
    const s = serverMit([ueberfaellig, hinweis], offen);
    renderZentrale();
    await waitFor(() => expect(s.offeneAbrufe.anzahl).toBe(1));

    // Während der Server neu startete, wurden beide fällig; der Server liefert jüngste zuerst.
    offen.push(hinweis, ueberfaellig);
    act(() => meldeNachreichen());

    expect(await screen.findByText('Auftrag überfällig')).toBeInTheDocument();
    expect(
      within(notice('Auftrag überfällig')).getByText('Auftrag #7 · 14:05'),
    ).toBeInTheDocument();
    expect(within(notice('Neuer Auftrag')).getByText('Auftrag #8 · 14:07')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('beim Öffnen eines Einsatzes: die offenen erscheinen, nur die dieses Einsatzes', async () => {
    const hier = benachrichtigung(45, 'befehl', 'befehl', 3);
    const dort = benachrichtigung(46, 'befehl', 'befehl', 4, { einsatz_id: 2 });
    serverMit([], [dort, hier]);
    renderZentrale();

    expect(await screen.findByText('Neuer Befehl')).toBeInTheDocument();
    expect(screen.getAllByText('Neuer Befehl')).toHaveLength(1);
    expect(screen.getByText('14:05')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('was der Tab schon zeigt, kommt nicht ein zweites Mal und klingt nicht', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    const s = serverMit([auftrag], [auftrag]);
    renderZentrale();
    expect(await screen.findByText('Neuer Auftrag')).toBeInTheDocument();
    ton.mockClear();

    live(auftrag);
    act(() => meldeNachreichen());
    await waitFor(() => expect(s.offeneAbrufe.anzahl).toBe(2));
    expect(screen.getAllByText('Neuer Auftrag')).toHaveLength(1);
    expect(ton).not.toHaveBeenCalled();
  });
});

describe('Sammeltoast (tasks.md 2.4)', () => {
  it('Fünf Hinweise: der Sammeltoast nennt je Art die Zahl und springt zu Aufträgen, Befehlen und Nachforderungen', async () => {
    const liste = [
      benachrichtigung(61, 'auftrag_erteilt', 'auftrag', 1),
      benachrichtigung(62, 'auftrag_erteilt', 'auftrag', 2),
      benachrichtigung(63, 'befehl', 'befehl', 3),
      benachrichtigung(64, 'nachforderung_status', 'nachforderung', 4),
      benachrichtigung(65, 'nachforderung_status', 'nachforderung', 5),
    ];
    const s = serverMit(liste);
    renderZentrale();
    for (const b of liste) {
      live(b);
      await waitFor(() => expect(ton).toHaveBeenCalledTimes(liste.indexOf(b) + 1));
    }

    // Vier im Sammeltoast, der jüngste bleibt einzeln stehen: alle fünf sind zu sehen.
    const sammel = (await screen.findByText('4 weitere Hinweise')).closest<HTMLElement>(
      '.ant-notification-notice',
    )!;
    expect(within(sammel).getByText('2 × Neuer Auftrag')).toBeInTheDocument();
    expect(within(sammel).getByText('1 × Neuer Befehl')).toBeInTheDocument();
    expect(within(sammel).getByText('1 × Status einer Nachforderung')).toBeInTheDocument();
    expect(within(sammel).getByRole('button', { name: 'Zu Aufträgen' })).toBeInTheDocument();
    expect(within(sammel).getByRole('button', { name: 'Zu Befehlen' })).toBeInTheDocument();
    expect(within(sammel).getByRole('button', { name: 'Zu Nachforderungen' })).toBeInTheDocument();
    // Der verdrängte Toast verlässt das DOM erst nach seiner Bewegung, die jsdom nicht beendet.
    const bleibend = screen
      .getAllByText('Status einer Nachforderung')
      .filter((el) => el.closest('[class*="-leave"]') == null);
    expect(bleibend).toHaveLength(1);

    await userEvent.click(within(sammel).getByRole('button', { name: 'Zu Befehlen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege?reiter=befehle');
    // Der Sprung räumt alle Toasts ab und quittiert sie.
    await waitFor(() => expect([...s.quittiert].sort()).toEqual([61, 62, 63, 64, 65]));
  });

  it('alle Arten teilen ein Budget: Sofortmeldungen und Hinweise bündeln gemeinsam', async () => {
    const sofort = [1, 2].map((n) =>
      benachrichtigung(80 + n, 'sofortmeldung', 'meldung', n, {
        titel: 'Sofortmeldung eingegangen',
      }),
    );
    const liste = [1, 2].map((n) => benachrichtigung(70 + n, 'auftrag_erteilt', 'auftrag', n));
    serverMit([...sofort, ...liste]);
    renderZentrale();
    for (const b of sofort) live(b);
    await waitFor(() => expect(screen.getAllByText('Sofortmeldung eingegangen')).toHaveLength(2));
    for (const b of liste) {
      live(b);
      await screen.findByText(`Auftrag #${b.bezug_id}`);
    }

    const sammel = (await screen.findByText('3 weitere Alarme')).closest<HTMLElement>(
      '.ant-notification-notice',
    )!;
    expect(within(sammel).getByText('2 × Sofortmeldung')).toBeInTheDocument();
    expect(within(sammel).getByText('1 × Neuer Auftrag')).toBeInTheDocument();
    expect(within(sammel).getByRole('button', { name: 'Zu Meldungen' })).toBeInTheDocument();
    expect(within(sammel).getByRole('button', { name: 'Zu Aufträgen' })).toBeInTheDocument();
  });
});
