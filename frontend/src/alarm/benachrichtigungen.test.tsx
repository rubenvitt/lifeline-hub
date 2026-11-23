import { act, render, screen, waitFor, within } from '@testing-library/react';
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
import AlarmZone from './AlarmZone';
import { spieleAlarmTon } from './alarmTon';
import { istAusgeblendet } from './benachrichtigungGedaechtnis';
import { BENACHRICHTIGUNG_ARTEN } from './benachrichtigungKatalog';
import { offeneDesktopAlarme, schliesseAlleDesktopAlarme } from './desktopAlarm';
import { setzeEingangTonZurueck } from './useEingangshinweis';
import { schliessePushMeldungen } from './webPush';

vi.mock('./webPush', async (original) => ({
  ...(await original<typeof import('./webPush')>()),
  schliessePushMeldungen: vi.fn(async () => undefined),
}));

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
function serverMit(
  liste: BenachrichtigungAnzeige[],
  offen: BenachrichtigungAnzeige[] = [],
  meldungen: Record<number, { absender: string; inhalt: string }> = {},
) {
  const quittiert: number[] = [];
  const abgerufen: number[] = [];
  const offeneAbrufe = { anzahl: 0 };
  server.use(
    // Absender und Wortlaut einer Sofortmeldung holt die Zentrale über die Meldung (LLH-1052).
    http.get('/api/einsaetze/:einsatzId/reports/:id', ({ params }) => {
      const m = meldungen[Number(params.id)];
      return m
        ? HttpResponse.json({ id: Number(params.id), ...m })
        : HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 });
    }),
    http.get('/api/notifications/:id', ({ params }) => {
      const id = Number(params.id);
      abgerufen.push(id);
      const b = liste.find((x) => x.id === id);
      return b
        ? HttpResponse.json(b)
        : HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 });
    }),
    http.get('/api/notifications', () => {
      offeneAbrufe.anzahl += 1;
      return HttpResponse.json(offen);
    }),
    http.post('/api/notifications/:id/acknowledge', ({ params }) => {
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
      <AlarmZone />
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
  await waitFor(() => expect(screen.queryByText(titel)).not.toBeInTheDocument());
}

/** Die Zeile eines Eintrags der Alarmzone (LLH-1735). */
function notice(titel: string): HTMLElement {
  const el = screen.getByText(titel).closest<HTMLElement>('[data-lfh="alarm-eintrag"]');
  if (!el) throw new Error(`kein Eintrag „${titel}“`);
  return el;
}

/** Das Eingangsband (LLH-1143 D7): dort stehen alle Eingänge des Einsatzes. */
function band(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-lfh="eingangsband"]');
  if (!el) throw new Error('kein Eingangsband');
  return el;
}

/** Einträge der Alarmzone, gebündelt oder nicht. */
function toastZahl(): number {
  return Number(document.querySelector<HTMLElement>('[data-lfh="alarmzone"]')?.dataset.anzahl ?? 0);
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
  // Die Drossel des Eingangstons ist modulweit (ein Ton je 2 min über alle Zentralen).
  setzeEingangTonZurueck();
  vi.mocked(schliessePushMeldungen).mockClear();
});

afterEach(() => {
  schliesseAlleDesktopAlarme();
  setzeHidden(false);
  vi.unstubAllGlobals();
  setzeViewportBreite(VIEWPORT_STANDARD);
});

describe('Benachrichtigungszentrale: Text, Ton und Toast (tasks.md 2.1)', () => {
  it('Eingang, Tab sichtbar: Band mit Text vom Server, dezenter Ton, kein Toast, keine OS-Meldung', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    serverMit([auftrag]);
    const { Ctor } = stubMeldungen();
    renderZentrale();
    live(auftrag);

    await screen.findByText('Neuer Auftrag');
    expect(within(band()).getByText('Auftrag #12')).toBeInTheDocument();
    // Ein Eingang nimmt keinen Toastplatz (LLH-1143 D7).
    expect(toastZahl()).toBe(0);
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('Eingang, Tab verdeckt: zusätzlich die OS-Meldung unter dem tag des Eingangs', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_erteilt', 'auftrag', 12);
    serverMit([auftrag]);
    const { Ctor } = stubMeldungen();
    setzeHidden(true);
    renderZentrale();
    live(auftrag);

    expect(await screen.findByText('Neuer Auftrag')).toBeInTheDocument();
    expect(Ctor).toHaveBeenCalledExactlyOnceWith('Neuer Auftrag', {
      body: 'Auftrag #12',
      tag: '1-eingang',
    });
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('Alarm, Tab sichtbar: Eintrag in der Alarmzone und Alarmton', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    serverMit([ueberfaellig]);
    const { Ctor } = stubMeldungen();
    renderZentrale();
    live(ueberfaellig);

    await screen.findByText('Auftrag überfällig');
    expect(within(notice('Auftrag überfällig')).getByText('ALARM')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('alarm');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('Auftrag überfällig nennt in der Alarmzone Nummer und Anfang des Auftragstexts (LLH-1909)', async () => {
    const ueberfaellig = benachrichtigung(42, 'auftrag_ueberfaellig', 'auftrag', 7);
    serverMit([ueberfaellig]);
    server.use(
      http.get('/api/einsaetze/:id/tasks/:aid', () =>
        HttpResponse.json({
          id: 7,
          lfd_nr: 7,
          auftrag_text: 'Sandsäcke an der Pegelstelle auffüllen',
          empfaenger: [],
        }),
      ),
    );
    stubMeldungen();
    renderZentrale();
    live(ueberfaellig);

    const n = await waitFor(() => notice('Auftrag überfällig'));
    expect(
      await within(n).findByText(/#7 · Sandsäcke an der Pegelstelle auffüllen/),
    ).toBeInTheDocument();
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

  it('Stufe still: kein Toast, kein Ton, kein Abruf — sie steht nur im Verlauf (LLH-1143)', async () => {
    const s = serverMit([]);
    renderZentrale();
    live(benachrichtigung(43, 'auftrag_erteilt', 'auftrag', 12, { stufe: 'still' }));
    await act(async () => {});
    expect(s.abgerufen).toEqual([]);
    expect(screen.queryByText('Neuer Auftrag')).not.toBeInTheDocument();
    expect(ton).not.toHaveBeenCalled();
  });

  it('ohne Text vom Server (Netzfehler) steht der Name der Art mit Sprung ins Modul', async () => {
    server.use(http.get('/api/notifications/:id', () => HttpResponse.error()));
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
  it('Zwei Tabs: „Gelesen“ im ersten quittiert, das Quittier-Ereignis nimmt den Eintrag im zweiten weg', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_ueberfaellig', 'auftrag', 12);
    const s = serverMit([auftrag]);
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderZentrale();
    live(auftrag);
    await screen.findByText('Auftrag überfällig');
    expect(offeneDesktopAlarme()).toBe(1);

    // Erster Tab: „Gelesen“ quittiert auf dem Server, die Seite bleibt.
    await userEvent.click(
      within(notice('Auftrag überfällig')).getByRole('button', { name: 'Gelesen' }),
    );
    await waitFor(() => expect(s.quittiert).toEqual([40]));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/start');
    expect(meldungen[0].close).toHaveBeenCalled();
    // Die Push-Meldung des Service Workers geht mit (LLH-1223, D7).
    expect(schliessePushMeldungen).toHaveBeenCalledWith(40);
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
    expect(schliessePushMeldungen).toHaveBeenCalledWith(40);
    expect(offeneDesktopAlarme()).toBe(0);
    // Dieser Tab quittiert nicht noch einmal, und ein Nachreichen bringt ihn nicht zurück.
    act(() => meldeNachreichen());
    await waitFor(() => expect(s.offeneAbrufe.anzahl).toBe(2));
    expect(screen.queryByText('Neuer Auftrag')).not.toBeInTheDocument();
    expect(s.quittiert).toEqual([]);
  });

  it('das Quittier-Ereignis nimmt eine gebündelte Benachrichtigung aus der Zone', async () => {
    const liste = [1, 2, 3, 4].map((n) =>
      benachrichtigung(50 + n, 'auftrag_ueberfaellig', 'auftrag', n),
    );
    serverMit(liste);
    renderZentrale();
    for (const b of liste) {
      live(b);
      await screen.findByText(`Auftrag #${b.bezug_id}`);
    }
    expect(await screen.findByRole('button', { name: '+ 3 weitere' })).toBeInTheDocument();

    live(liste[0], true);
    expect(await screen.findByRole('button', { name: '+ 2 weitere' })).toBeInTheDocument();
    expect(toastZahl()).toBe(3);
  });

  it('✕ blendet aus, ohne zu quittieren; das Nachreichen bringt den Alarm nicht zurück (LLH-1736)', async () => {
    const auftrag = benachrichtigung(40, 'auftrag_ueberfaellig', 'auftrag', 12);
    const s = serverMit([auftrag], [auftrag]);
    const { meldungen } = stubMeldungen();
    setzeHidden(true);
    renderZentrale();
    await screen.findByText('Auftrag überfällig');

    await userEvent.click(
      within(notice('Auftrag überfällig')).getByRole('button', {
        name: 'Ausblenden, ohne zu quittieren',
      }),
    );
    await warteBisNotificationWeg('Auftrag überfällig');
    // Die OS-Meldung dieses Tabs geht mit, die Push-Meldungen anderer Geräte bleiben.
    expect(meldungen[0].close).toHaveBeenCalled();
    expect(schliessePushMeldungen).not.toHaveBeenCalled();
    expect(s.quittiert).toEqual([]);

    act(() => meldeNachreichen());
    await waitFor(() => expect(s.offeneAbrufe.anzahl).toBe(2));
    expect(screen.queryByText('Auftrag überfällig')).not.toBeInTheDocument();
    expect(s.quittiert).toEqual([]);
    // Quittiert ein anderes Gerät, ist das Merken erledigt.
    expect(istAusgeblendet(40)).toBe(true);
    live(auftrag, true);
    expect(istAusgeblendet(40)).toBe(false);
  });

  it('„Alle gelesen“ auf einem anderen Gerät räumt die Eingänge, nie einen Alarm (LLH-1143)', async () => {
    const alarm = benachrichtigung(55, 'auftrag_ueberfaellig', 'auftrag', 5);
    const eingang = benachrichtigung(56, 'auftrag_erteilt', 'auftrag', 6);
    const s = serverMit([alarm, eingang]);
    renderZentrale();
    live(alarm);
    live(eingang);
    await screen.findByText('Auftrag überfällig');
    await screen.findByText('Neuer Auftrag');

    act(() => {
      const detail: BenachrichtigungEreignis = { ...ereignisVon(eingang, true), gelesen_bis: 56 };
      window.dispatchEvent(new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, { detail }));
    });
    await waitFor(() => expect(screen.queryByText('Neuer Auftrag')).not.toBeInTheDocument());
    expect(screen.getByText('Auftrag überfällig')).toBeInTheDocument();
    expect(s.quittiert).toEqual([]);
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
      within(notice('Auftrag überfällig')).getByText('Auftrag #7 · 141405'),
    ).toBeInTheDocument();
    // Der Eingang steht im Band, nicht im Budget; für beide zusammen EIN Ton.
    await waitFor(() => expect(band()).toHaveTextContent('Auftrag #8 · 141407'));
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('eine nachgereichte Sofortmeldung nennt Absender und Wortlaut mit ihrer Uhrzeit (LLH-1052)', async () => {
    const sofort = benachrichtigung(47, 'sofortmeldung', 'meldung', 5, {
      titel: 'Sofortmeldung eingegangen',
      detail: 'Meldung #5',
      pfad: '/einsaetze/1/meldungen?meldung=5',
    });
    serverMit([], [sofort], { 5: { absender: 'RTW 2', inhalt: 'Patient übergeben' } });
    renderZentrale();

    expect(await screen.findByText('Sofortmeldung · RTW 2')).toBeInTheDocument();
    expect(
      within(notice('Sofortmeldung · RTW 2')).getByText('Patient übergeben · 141405'),
    ).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('beim Öffnen eines Einsatzes: die offenen erscheinen, nur die dieses Einsatzes', async () => {
    const hier = benachrichtigung(45, 'befehl', 'befehl', 3);
    const dort = benachrichtigung(46, 'befehl', 'befehl', 4, { einsatz_id: 2 });
    serverMit([], [dort, hier]);
    renderZentrale();

    expect(await screen.findByText('Neuer Befehl')).toBeInTheDocument();
    expect(screen.getAllByText('Neuer Befehl')).toHaveLength(1);
    expect(within(band()).getByText('141405')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('ein beim Öffnen nachgespielter Alarm tönt dezent, also ohne Alarmton und Haptik (t39ltxxi)', async () => {
    const ueberfaellig = benachrichtigung(41, 'auftrag_ueberfaellig', 'auftrag', 7);
    serverMit([], [ueberfaellig]);
    renderZentrale();

    expect(await screen.findByText('Auftrag überfällig')).toBeInTheDocument();
    await waitFor(() => expect(ton).toHaveBeenCalled());
    // Haptik `warning` gibt allein `spieleAlarmTon('alarm')` (alarmTon.test.ts).
    expect(ton).not.toHaveBeenCalledWith('alarm');
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

describe('Gebündelte Alarmzone (LLH-1735)', () => {
  it('Fünf Alarme: die Zone nennt je Art die Zahl, jede Zeile springt und quittiert nur sich', async () => {
    const liste = [
      benachrichtigung(61, 'auftrag_ueberfaellig', 'auftrag', 1),
      benachrichtigung(62, 'auftrag_ueberfaellig', 'auftrag', 2),
      benachrichtigung(63, 'sofortmeldung', 'meldung', 3, { titel: 'Sofortmeldung eingegangen' }),
      benachrichtigung(64, 'abloesung_faellig', 'abloesung', 4, { titel: 'Ablösung fällig' }),
      benachrichtigung(65, 'abloesung_faellig', 'abloesung', 5, { titel: 'Ablösung fällig' }),
    ];
    const s = serverMit(liste);
    renderZentrale();
    for (const b of liste) {
      live(b);
      await waitFor(() => expect(ton).toHaveBeenCalledTimes(liste.indexOf(b) + 1));
    }

    // Zu: der jüngste mit „+ 4 weitere“; auf: Kopfzeile mit Zahl und Arten.
    await userEvent.click(await screen.findByRole('button', { name: '+ 4 weitere' }));
    expect(screen.getByText('5 Alarme')).toBeInTheDocument();
    expect(
      screen.getByText('2 × Auftrag überfällig · 1 × Sofortmeldung · 2 × Ablösung fällig'),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('[data-lfh="alarm-eintrag"]')).toHaveLength(5);

    const zeile = screen
      .getByText('Auftrag #1')
      .closest<HTMLElement>('[data-lfh="alarm-eintrag"]')!;
    await userEvent.click(within(zeile).getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege?auftrag=1');
    // Der Sprung quittiert nur seinen Alarm, die übrigen vier stehen weiter.
    await waitFor(() => expect(s.quittiert).toEqual([61]));
    expect(toastZahl()).toBe(4);
  });

  it('Eingänge stehen nicht in der Zone: drei Alarme und fünf Eingänge (LLH-1143)', async () => {
    const alarme = [1, 2, 3].map((n) =>
      benachrichtigung(80 + n, 'sofortmeldung', 'meldung', n, {
        titel: 'Sofortmeldung eingegangen',
      }),
    );
    const eingaenge = [1, 2, 3, 4, 5].map((n) =>
      benachrichtigung(70 + n, 'auftrag_erteilt', 'auftrag', n),
    );
    serverMit([...alarme, ...eingaenge]);
    renderZentrale();
    for (const b of alarme) live(b);
    await waitFor(() => expect(toastZahl()).toBe(3));
    for (const b of eingaenge) live(b);
    await waitFor(() => expect(band()).toHaveTextContent('5 neue Eingänge'));

    expect(toastZahl()).toBe(3);
  });
});
