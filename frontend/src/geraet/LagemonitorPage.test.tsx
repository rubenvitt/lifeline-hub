import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import type { GeraetAnzeige, LagemonitorAnzeige } from '../api/types';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { alterText, istVeraltet, LANG_DRUECKEN_MS, MENUE_ZU_MS } from './LagemonitorPage';
import { monitorAusschnitt } from './LagemonitorKarte';

// jsdom hat kein WebGL: die Karte selbst gehört nach `e2e/geraet-lagemonitor.spec.ts`.
vi.mock('./LagemonitorKarte', async (original) => ({
  ...(await original<typeof import('./LagemonitorKarte')>()),
  default: () => <div data-lfh="lagemonitor-karte" />,
}));

/**
 * Lagemonitor (LFH-892, Spec `lagemonitor`): Großbild als Startseite, Zahlen ohne Personen,
 * Wachhalten, Datenstand mit Alter und das Gerätemenü auf langes Drücken.
 */

const JETZT = Date.parse('2026-10-04T10:00:00Z');

const monitor: GeraetAnzeige = {
  kopplung_id: 4,
  einsatz_id: 7,
  ansicht: 'lagemonitor',
  uhs_id: null,
  stelle: null,
  bezeichnung: 'Monitor Stab',
  laeuft_ab_at: '2026-10-04 18:00:00',
};

const lage: LagemonitorAnzeige = {
  stand_at: '2026-10-04 10:00:00',
  betroffene: {
    gesamt: 12,
    patienten: 5,
    sk1: 1,
    sk2: 2,
    sk3: 1,
    sk4: 1,
    tot: 0,
    unverletzt: 4,
    ohne: 3,
    vermisst: 2,
  },
  kraefte: { einheiten: 4, personal: 38, staerke: { fuehrer: 2, unterfuehrer: 6, mannschaft: 30 } },
  uhs: [
    {
      id: 2,
      bezeichnung: 'UHS Nord',
      typ: 'behandlungsplatz',
      status: 'aktiv',
      lat: 52.5,
      lon: 13.4,
      belegt: 3,
      plaetze: 8,
    },
  ],
};

let lagebildAntwort: () => Response;

function bereit(g: GeraetAnzeige = monitor) {
  lagebildAntwort = () => HttpResponse.json(lage);
  server.use(
    meHandler({ ...benutzerFixture({ id: 51, anzeigename: 'Monitor Stab' }), geraet: g }),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json(
        einsatzFixture({ id: 7, bezeichnung: 'Stadtfest', meine_rolle: 'beobachter' }),
      ),
    ),
    http.get('/api/einsaetze/7/lagemonitor', () => lagebildAntwort()),
  );
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

const wakeRequest = vi.fn();

function mitWakeLock() {
  wakeRequest.mockImplementation(async () => {
    const sperre = new EventTarget() as WakeLockSentinel;
    Object.assign(sperre, { release: vi.fn(async () => undefined) });
    return sperre;
  });
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: wakeRequest },
  });
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  wakeRequest.mockReset();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  localStorage.clear();
});

describe('Lagemonitor — Großbild', () => {
  it('startet auf dem Großbild mit Kopfzahlen, Kräften und Belegung je UHS', async () => {
    bereit();
    const router = renderApp('/geraet');
    await waitFor(() => expect(router.state.location.pathname).toBe('/geraet/7/monitor'));
    const betroffene = await screen.findByRole('region', { name: 'Betroffene' });
    expect(within(betroffene).getByText('12')).toBeInTheDocument();
    expect(within(betroffene).getByText('vermisst')).toBeInTheDocument();
    const kraefte = screen.getByRole('region', { name: 'Kräfte' });
    expect(within(kraefte).getByText('2/6/30')).toBeInTheDocument();
    const belegung = screen.getByRole('region', { name: 'Belegung der Unfallhilfsstellen' });
    expect(within(belegung).getByText('3/8')).toBeInTheDocument();
    expect(within(belegung).getByText('UHS Nord')).toBeInTheDocument();
    // Keine Gerätenavigation und keine Kopfzeile der UHS-Geräte.
    expect(screen.queryByRole('navigation', { name: 'Gerätenavigation' })).toBeNull();
    // Kacheln ohne Bedienung.
    expect(betroffene.closest('main')!.style.pointerEvents).toBe('none');
    expect(screen.getByText('Stadtfest')).toBeInTheDocument();
  });

  it('Kennzahlen sind mindestens 72 px, jeder Text mindestens 28 px', async () => {
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const zahlen = document.querySelectorAll<HTMLElement>('[data-lfh="monitor-zahl"]');
    expect(zahlen.length).toBeGreaterThan(5);
    for (const z of zahlen) {
      const [zahl, text] = z.children as unknown as HTMLElement[];
      expect(parseInt(zahl.style.fontSize, 10)).toBeGreaterThanOrEqual(72);
      expect(parseInt(text.style.fontSize, 10)).toBeGreaterThanOrEqual(28);
    }
  });

  it('ein Monitor hat keine UHS-Seiten, ein Tablet kein Großbild', async () => {
    bereit();
    const router = renderApp('/geraet/7/patienten');
    await waitFor(() => expect(router.state.location.pathname).toBe('/geraet/7/monitor'));
  });

  it('„Anzeige starten“ fordert Vollbild und Wachhalten an, bei Rückkehr neu', async () => {
    mitWakeLock();
    bereit();
    renderApp('/geraet/7/monitor');
    fireEvent.click(await screen.findByRole('button', { name: 'Anzeige starten' }));
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    await waitFor(() => expect(wakeRequest).toHaveBeenCalledWith('screen'));
    expect(screen.queryByRole('button', { name: 'Anzeige starten' })).toBeNull();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(wakeRequest).toHaveBeenCalledTimes(2));
    expect(document.querySelector('[data-lfh="monitor-wach-hinweis"]')).toBeNull();
  });

  it('ohne Wachhalten: dauerhafter Hinweis zum Bildschirmschoner, die Anzeige läuft weiter', async () => {
    bereit();
    renderApp('/geraet/7/monitor');
    expect(await screen.findByRole('note')).toHaveTextContent(/Bildschirmschoner/);
    fireEvent.click(screen.getByRole('button', { name: 'Anzeige starten' }));
    expect(screen.getByRole('region', { name: 'Betroffene' })).toBeInTheDocument();
  });
});

describe('Lagemonitor — Aktualität und Gerätemenü', () => {
  it('Veralteter Stand: nach 3 Minuten ohne neue Zahlen hervorgehoben', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const stand = () => document.querySelector<HTMLElement>('[data-lfh="monitor-datenstand"]')!;
    expect(stand().getAttribute('data-veraltet')).toBe('nein');
    lagebildAntwort = () => HttpResponse.json({ fehler: 'weg' }, { status: 503 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(stand().getAttribute('data-veraltet')).toBe('ja');
    expect(stand().textContent).toMatch(/Veraltet · Stand .* · vor 3 min/);
  });

  it('kurzes Tippen öffnet kein Menü, 3 s Drücken schon, nach 30 s ohne Eingabe zu', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const leiste = document.querySelector<HTMLElement>('[data-lfh="monitor-statusleiste"]')!;

    fireEvent.pointerDown(leiste);
    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.pointerUp(leiste);
    act(() => vi.advanceTimersByTime(LANG_DRUECKEN_MS));
    expect(screen.queryByRole('dialog', { name: 'Gerätemenü' })).toBeNull();

    fireEvent.pointerDown(leiste);
    act(() => vi.advanceTimersByTime(LANG_DRUECKEN_MS));
    fireEvent.pointerUp(leiste);
    expect(screen.getByRole('dialog', { name: 'Gerätemenü' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(MENUE_ZU_MS));
    expect(screen.queryByRole('dialog', { name: 'Gerätemenü' })).toBeNull();
  });

  it('„Nacht“ im Gerätemenü gilt auch nach einem Neuladen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const leiste = document.querySelector<HTMLElement>('[data-lfh="monitor-statusleiste"]')!;
    fireEvent.pointerDown(leiste);
    act(() => vi.advanceTimersByTime(LANG_DRUECKEN_MS));
    const menue = screen.getByRole('dialog', { name: 'Gerätemenü' });
    fireEvent.click(within(menue).getByRole('button', { name: 'Tag' }));
    fireEvent.click(within(menue).getByRole('button', { name: 'Nacht' }));
    expect(localStorage.getItem('lifeline-hub.theme')).toBe('dark');
    expect(within(menue).getByRole('button', { name: 'Nacht' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('Bausteine', () => {
  it('istVeraltet und alterText', () => {
    expect(istVeraltet(JETZT, JETZT + 2 * 60_000)).toBe(false);
    expect(istVeraltet(JETZT, JETZT + 2 * 60_000 + 1)).toBe(true);
    expect(istVeraltet(0, JETZT)).toBe(false);
    expect(alterText(JETZT, JETZT + 30_000)).toBe('gerade eben');
    expect(alterText(JETZT, JETZT + 3 * 60_000)).toBe('vor 3 min');
  });

  it('monitorAusschnitt: ein Punkt mit Zoom, mehrere als Rahmen, keiner ohne Karte', () => {
    expect(monitorAusschnitt([])).toBeNull();
    expect(monitorAusschnitt([{ lat: 52, lon: 13 }])).toMatchObject({ art: 'punkt', lat: 52 });
    expect(
      monitorAusschnitt([
        { lat: 52, lon: 13 },
        { lat: 53, lon: 12 },
      ]),
    ).toEqual({ art: 'rahmen', west: 12, sued: 52, ost: 13, nord: 53 });
  });
});
