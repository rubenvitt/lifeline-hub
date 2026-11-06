import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import type {
  Auftrag,
  AuftragEmpfaenger,
  Einheit,
  FahrzeugStatus,
  GeraetAnzeige,
} from '../api/types';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import {
  OHNE_VERBINDUNG_NICHT_AENDERBAR,
  meldeServerErreichbar,
  verbindungZuruecksetzenFuerTests,
} from '../offline/verbindung';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { queueLeerenFuerTests } from '../offline/queue';
import { AUFTRAG_VIBRATION_MS, neueAuftraege } from './auftragsVibration';

vi.mock('../alarm/alarmTon', async (original) => ({
  ...(await original<typeof import('../alarm/alarmTon')>()),
  spieleAlarmTon: vi.fn(),
}));

/**
 * Die Funktionsansicht „Einheit“ in der Gerätehülle (LLH-1579, Konzept LLH-1571 S1): Aufträge als
 * Startseite, Status der eigenen Einheit, Melden mit Standort auf Knopfdruck, kurze Vibration bei
 * einem neuen Auftrag. Den Zuschnitt auf die eigene Einheit leistet der Server
 * (`tests/geraet_kopplung.rs`); hier liefert er ihn schon fertig.
 */

function geraet(ueber: Partial<GeraetAnzeige> = {}): GeraetAnzeige {
  return {
    kopplung_id: 4,
    einsatz_id: 7,
    ansicht: 'einheit',
    uhs_id: null,
    stelle_id: 5,
    stelle: '2. Zug',
    bezeichnung: 'Handy',
    laeuft_ab_at: '2099-01-01 18:00:00',
    ...ueber,
  } as GeraetAnzeige;
}

function einheit(p: Partial<Einheit> = {}): Einheit {
  return {
    id: 5,
    einsatz_id: 7,
    name: '2. Zug',
    sortier: 1,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 1, mannschaft: 4 },
    status: { quelle: 'ohne', verteilung: [] },
    verbindungen: [],
    ...p,
  } as Einheit;
}

const KATALOG: FahrzeugStatus[] = [
  { id: 11, label: 'Einsatzbereit über Funk', fms_anker: 1, kategorie: 'verfuegbar', sortier: 1 },
  { id: 13, label: 'Einsatz übernommen', fms_anker: 3, kategorie: 'gebunden', sortier: 3 },
] as FahrzeugStatus[];

function empfaenger(id: number, p: Partial<AuftragEmpfaenger>): AuftragEmpfaenger {
  return {
    id,
    auftrag_id: 31,
    empfaenger_typ: 'einheit',
    snap_anzeige: `Empfänger ${id}`,
    quittiert_at: null,
    ...p,
  } as AuftragEmpfaenger;
}

function auftrag(id: number, text: string): Auftrag {
  return {
    id,
    einsatz_id: 7,
    lfd_nr: id,
    auftrag_text: text,
    prioritaet: 'normal',
    richtung: 'intern',
    frist_at: null,
    erteilt_at: '2026-11-06 08:00:00',
    in_arbeit_at: null,
    erstellt_von_id: 1,
    erstellt_at: '2026-11-06 08:00:00',
    vollzug_status: 'offen',
    empfaenger_anzahl: 2,
    quittiert_anzahl: 0,
    ist_ueberfaellig: false,
    bearbeitungsstatus: 'offen',
    empfaenger: [
      empfaenger(id * 10 + 1, { auftrag_id: id, einheit_id: 5, snap_anzeige: '2. Zug' }),
      empfaenger(id * 10 + 2, { auftrag_id: id, einheit_id: 4, snap_anzeige: '1. Zug' }),
    ],
  } as Auftrag;
}

function stelleBereit({
  g = geraet(),
  e = einheit(),
  auftraege = [auftrag(31, 'Pumpe aufbauen')],
}: { g?: GeraetAnzeige; e?: Einheit; auftraege?: Auftrag[] } = {}) {
  const quittiert: string[] = [];
  const gesendet: unknown[] = [];
  const status: unknown[] = [];
  const abgerufen: string[] = [];
  const stand = { auftraege };
  server.use(
    meHandler({ ...benutzerFixture({ id: 60, anzeigename: '2. Zug · Handy' }), geraet: g }),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json(einsatzFixture({ id: 7, meine_rolle: 'fuehrungspersonal' })),
    ),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([e])),
    http.get('/api/einsaetze/7/abschnitte', () => {
      abgerufen.push('abschnitte');
      return HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 });
    }),
    http.get('/api/einsaetze/7/befehle', () => {
      abgerufen.push('befehle');
      return HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 });
    }),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(KATALOG)),
    http.get('/api/einsaetze/7/auftraege', () => HttpResponse.json(stand.auftraege)),
    http.post('/api/einsaetze/7/auftraege/:aid/empfaenger/:eid/quittieren', ({ params }) => {
      quittiert.push(`${params.aid}/${params.eid}`);
      return HttpResponse.json(stand.auftraege[0]);
    }),
    http.put('/api/einsaetze/7/einheiten/5/status', async ({ request }) => {
      status.push(await request.json());
      return HttpResponse.json(e);
    }),
    http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json([])),
    http.post('/api/einsaetze/7/meldungen', async ({ request }) => {
      gesendet.push(await request.json());
      return HttpResponse.json({ id: 41, lfd_nr: 5 }, { status: 201 });
    }),
  );
  return { quittiert, gesendet, status, abgerufen, stand };
}

function renderApp(route: string) {
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  render(
    <QueryClientProvider client={neuerQueryClient()}>
      <ThemeModeProvider>
        <ConfigProvider>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
  return router;
}

const pfad = (router: ReturnType<typeof renderApp>) => router.state.location.pathname;

const vibrate = vi.fn<(muster: number) => boolean>(() => true);

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(spieleAlarmTon).mockClear();
  vibrate.mockClear();
  Reflect.deleteProperty(navigator, 'vibrate');
  Reflect.deleteProperty(navigator, 'geolocation');
  await queueLeerenFuerTests();
  FakeEventSource.zuruecksetzen();
  verbindungZuruecksetzenFuerTests();
  localStorage.clear();
});

describe('Einheitengerät — Startseite und Navigation', () => {
  it('beginnt mit den Aufträgen der Einheit; Status und Melden daneben, keine Karte', async () => {
    const { abgerufen } = stelleBereit();
    const router = renderApp('/geraet');
    expect(await screen.findByText('Pumpe aufbauen')).toBeVisible();
    expect(pfad(router)).toBe('/geraet/7/auftraege');
    const nav = screen.getByRole('navigation', { name: 'Gerätenavigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Aufträge', 'Status', 'Melden']);
    // Abschnitte und Befehle gehören nicht zur Ansicht (403): die Seite fragt sie nicht ab.
    expect(abgerufen).toEqual([]);
  });

  it('Seiten anderer Ansichten führen auf die Aufträge', async () => {
    stelleBereit();
    const router = renderApp('/geraet/7/abschnitt');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/auftraege'));
  });

  it('quittiert nur die Zeile der eigenen Einheit', async () => {
    const { quittiert } = stelleBereit();
    renderApp('/geraet/7/auftraege');
    expect(await screen.findByText('Pumpe aufbauen')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Empfang für 2. Zug quittieren' })).toBeVisible(),
    );
    expect(screen.queryByRole('button', { name: 'Empfang für 1. Zug quittieren' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Empfang für 2. Zug quittieren' }));
    await user.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
    await waitFor(() => expect(quittiert).toEqual(['31/311']));
  });

  it('ohne Verbindung bleibt die Liste stehen, Quittung und Vollzug sind gesperrt', async () => {
    stelleBereit();
    renderApp('/geraet/7/auftraege');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Empfang für 2. Zug quittieren' })).toBeVisible(),
    );
    act(() => meldeServerErreichbar(false));
    expect(await screen.findByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeVisible();
    expect(screen.getByText('Pumpe aufbauen')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Empfang für 2. Zug quittieren' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Vollzug melden/ })).toBeNull();
  });
});

describe('Einheitengerät — Vibration (Spec `benachrichtigungen`)', () => {
  it('vibriert kurz bei einem neuen Auftrag, nicht beim Start und ohne Ton', async () => {
    const { stand } = stelleBereit();
    renderApp('/geraet/7/status');
    expect(await screen.findByRole('heading', { level: 1, name: 'Status' })).toBeVisible();
    const strom = FakeEventSource.instanzen.find(
      (q) => q.url === '/api/einsaetze/7/live' && !q.closed,
    );
    expect(strom, 'der Einsatzstrom des Geräts ist offen').toBeDefined();
    // Der Startstand ist abgerufen, bevor der neue Auftrag kommt.
    await waitFor(() => expect(screen.getByRole('link', { name: 'Aufträge' })).toBeVisible());
    await new Promise((r) => setTimeout(r, 50));
    expect(vibrate).not.toHaveBeenCalled();

    stand.auftraege = [...stand.auftraege, auftrag(32, 'Schlauch legen')];
    act(() => {
      strom!.emit('auftrag', JSON.stringify({ einsatz_id: 7 }));
    });
    await waitFor(() => expect(vibrate).toHaveBeenCalledTimes(1));
    expect(vibrate).toHaveBeenCalledWith(AUFTRAG_VIBRATION_MS);
    expect(spieleAlarmTon).not.toHaveBeenCalled();
  });

  it('kennt nur neue Kennungen als neu, der erste Stand ist nie neu', () => {
    expect(neueAuftraege(null, [{ id: 1 }])).toEqual([]);
    expect(neueAuftraege(new Set([1]), [{ id: 1 }, { id: 2 }])).toEqual([2]);
    expect(neueAuftraege(new Set([1, 2]), [{ id: 2 }])).toEqual([]);
  });
});

describe('Einheitengerät — Status', () => {
  it('zeigt den Status mit „seit“ und setzt ihn über eine Fläche des Katalogs', async () => {
    const { status } = stelleBereit({
      e: einheit({
        status: {
          quelle: 'hand',
          seit: '2026-11-06 08:15:00',
          status: {
            status_id: 11,
            label: 'Einsatzbereit über Funk',
            fms_anker: 1,
            kategorie: 'verfuegbar',
            sortier: 1,
          },
          verteilung: [],
        } as Einheit['status'],
      }),
    });
    renderApp('/geraet/7/status');
    const aktuell = await screen.findByText(/seit/);
    expect(aktuell).toBeVisible();
    const gruppe = await screen.findByRole('group', { name: 'Status setzen' });
    const flaechen = within(gruppe).getAllByRole('button');
    expect(flaechen).toHaveLength(2);
    expect(flaechen[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(gruppe).queryByText(/kein Status/)).toBeNull();

    const user = userEvent.setup();
    await user.click(flaechen[1]);
    await waitFor(() => expect(status).toEqual([{ status_id: 13 }]));
  });

  it('mit Fahrzeug nur Anzeige (F8)', async () => {
    stelleBereit({
      e: einheit({
        fahrzeug_mitglieder: [{ id: 1 }] as unknown as Einheit['fahrzeug_mitglieder'],
      }),
    });
    renderApp('/geraet/7/status');
    expect(await screen.findByRole('heading', { level: 2, name: '2. Zug' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Status setzen' })).toBeNull();
  });

  it('ohne Verbindung gesperrt, nicht vorgemerkt (F5)', async () => {
    const { status } = stelleBereit();
    renderApp('/geraet/7/status');
    const gruppe = await screen.findByRole('group', { name: 'Status setzen' });
    act(() => meldeServerErreichbar(false));
    expect(await screen.findByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeVisible();
    for (const f of within(gruppe).getAllByRole('button')) expect(f).toBeDisabled();
    expect(status).toEqual([]);
  });
});

describe('Einheitengerät — Melden', () => {
  it('meldet mit Einheit und Gerät als Absender und auf Knopfdruck mit Standort', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({
        coords: { latitude: 50.11, longitude: 8.68, accuracy: 12 },
      } as GeolocationPosition),
    );
    const watchPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
    });
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/melden');
    expect(await screen.findByRole('heading', { level: 1, name: 'Melden' })).toBeVisible();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Inhalt'), 'Pumpe läuft');
    await user.click(screen.getByRole('button', { name: 'Mein Standort' }));
    expect(await screen.findByText(/± 12/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      absender: '2. Zug · Handy',
      empfaenger: 'Einsatzleitung',
      meldungsart: 'sonstige',
      inhalt: 'Pumpe läuft',
      lat: 50.11,
      lon: 8.68,
    });
    // Einmal ermittelt, keine laufende Ortung (F3).
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition).not.toHaveBeenCalled();
    // Den Absenderbezug setzt der Server auf die gebundene Einheit.
    expect(gesendet[0]).not.toHaveProperty('einheit_id');
  });

  it('ohne Knopfdruck kein Standort', async () => {
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/melden');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Inhalt'), 'Lage ruhig');
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).not.toHaveProperty('lat');
    expect(gesendet[0]).not.toHaveProperty('lon');
  });

  it('ein Standort, der erst nach dem Senden kommt, verortet nicht die nächste Meldung', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    let antwort: PositionCallback | undefined;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) => {
          antwort = ok;
        },
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/melden');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Inhalt'), 'Erste');
    await user.click(screen.getByRole('button', { name: 'Mein Standort' }));
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).not.toHaveProperty('lat');
    await waitFor(() => expect(screen.getByLabelText('Inhalt')).toHaveValue(''));
    act(() =>
      antwort?.({
        coords: { latitude: 50.11, longitude: 8.68, accuracy: 12 },
      } as GeolocationPosition),
    );
    expect(screen.queryByText(/± 12/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Inhalt'), 'Zweite');
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(2));
    expect(gesendet[1]).not.toHaveProperty('lat');
  });

  it('meldet auch, wenn die Einheitenliste nicht kommt', async () => {
    const { gesendet } = stelleBereit();
    server.use(
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(null, { status: 500 })),
    );
    renderApp('/geraet/7/melden');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Inhalt'), 'Lage ruhig');
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
  });
});
