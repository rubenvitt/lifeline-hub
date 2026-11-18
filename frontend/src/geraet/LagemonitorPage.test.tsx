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
import {
  ABRUF_TAKT_MS,
  HERVORHEBUNG_MS,
  istVeraltet,
  LANG_DRUECKEN_MS,
  MENUE_ZU_MS,
} from './LagemonitorPage';
import { monitorAusschnitt } from './LagemonitorKarte';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { EINSATZKOPF_REFETCH_MS } from '../components/instrument';
import { GROSS_BEZUG, grossMass } from '../components/grossbild';

// Ob der Monitor einen Ton spielt, zeigt der Aufruf; jsdom hat kein Web-Audio.
vi.mock('../alarm/alarmTon', async (original) => ({
  ...(await original<typeof import('../alarm/alarmTon')>()),
  spieleAlarmTon: vi.fn(),
}));

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
    abgeschlossen: 0,
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
      kraefte: 4,
    },
  ],
  zonen: [],
  abschnitte: [],
  sofortmeldungen_offen: 0,
  programm: [],
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

/**
 * Pixel einer Großbild-Länge am Monitor: dort setzt die Wurzel `--lfh-gross-einheit: 1px`, also
 * zählt der Faktor aus `grossMass(px)`.
 */
function monitorPx(fontSize: string): number {
  const m = /^calc\(var\(--lfh-gross-einheit, [^)]*\)\) \* ([\d.]+)\)$/.exec(fontSize);
  if (!m) throw new Error(`keine Großbild-Länge: ${fontSize}`);
  return Number(m[1]);
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
  vi.mocked(spieleAlarmTon).mockClear();
  FakeEventSource.zuruecksetzen();
  wakeRequest.mockReset();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  localStorage.clear();
});

describe('Lagemonitor — Großbild', () => {
  it('„an UHS“ zählt nur aktive UHS; eine geplante steht weiter in der Belegung (LLH-1744)', async () => {
    bereit();
    lagebildAntwort = () =>
      HttpResponse.json({
        ...lage,
        uhs: [
          ...lage.uhs,
          {
            ...lage.uhs[0],
            id: 3,
            bezeichnung: 'UHS Süd',
            status: 'geplant',
            belegt: 0,
            kraefte: 2,
          },
        ],
      });
    renderApp('/geraet/7/monitor');
    const kraefte = await screen.findByRole('region', { name: 'Kräfte' });
    expect(await within(kraefte).findByText('4 an UHS')).toBeInTheDocument();
    const belegung = screen.getByRole('region', { name: 'Belegung der Unfallhilfsstellen' });
    expect(within(belegung).getByText('UHS Süd')).toBeInTheDocument();
  });

  it('startet auf dem Großbild mit Kopfzahlen, Kräften und Belegung je UHS', async () => {
    bereit();
    const router = renderApp('/geraet');
    await waitFor(() => expect(router.state.location.pathname).toBe('/geraet/7/monitor'));
    const betroffene = await screen.findByRole('region', { name: 'Betroffene' });
    expect(within(betroffene).getByText('12')).toBeInTheDocument();
    expect(within(betroffene).getByText('vermisst')).toBeInTheDocument();
    const kraefte = screen.getByRole('region', { name: 'Kräfte' });
    expect(within(kraefte).getByText('2/6/30')).toBeInTheDocument();
    // Kräfte an den UHS nur als Zahl (LFH-1045).
    expect(within(kraefte).getByText('4 an UHS')).toBeInTheDocument();
    const belegung = screen.getByRole('region', { name: 'Belegung der Unfallhilfsstellen' });
    expect(within(belegung).getByText('3/8')).toBeInTheDocument();
    expect(within(belegung).getByText('UHS Nord')).toBeInTheDocument();
    // Keine Gerätenavigation und keine Kopfzeile der UHS-Geräte.
    expect(screen.queryByRole('navigation', { name: 'Gerätenavigation' })).toBeNull();
    // Kacheln ohne Bedienung.
    expect(betroffene.closest('main')!.style.pointerEvents).toBe('none');
    // Der Einsatz kommt mit einem eigenen Abruf, unabhängig vom Lagebild.
    expect(await screen.findByText('Stadtfest')).toBeInTheDocument();
  });

  it('eine Übung trägt in der Statusleiste die Übungsmarke in mindestens 28 px (LLH-1725)', async () => {
    bereit();
    server.use(
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json(
          einsatzFixture({
            id: 7,
            bezeichnung: 'Stadtfest',
            meine_rolle: 'beobachter',
            einsatzart: 'uebung',
          }),
        ),
      ),
    );
    renderApp('/geraet/7/monitor');
    expect(await screen.findByText('Stadtfest')).toBeInTheDocument();
    const leiste = document.querySelector('[data-lfh="monitor-statusleiste"]')!;
    const marke = await waitFor(() => {
      const el = leiste.querySelector<HTMLElement>('[data-lfh="uebung-marke"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const wort = within(marke).getByText('Übung');
    expect(parseInt(wort.style.fontSize, 10)).toBeGreaterThanOrEqual(28);
    // Kein Band oben: die Kachelung bleibt (design.md D7).
    expect(document.querySelector('[data-lfh="uebung-band"]')).toBeNull();
  });

  it('scheitert der Einsatzkopf, nennt die Statusleiste „Einsatzart nicht geladen“ (LLH-1725)', async () => {
    bereit();
    server.use(http.get('/api/einsaetze/7', () => new HttpResponse(null, { status: 503 })));
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const leiste = document.querySelector<HTMLElement>('[data-lfh="monitor-statusleiste"]')!;
    expect(await within(leiste).findByText('Einsatzart nicht geladen')).toBeInTheDocument();
  });

  it('lädt den Einsatzkopf nach 30 s nach und zeigt dann die Marke (LLH-1725)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    let abrufe = 0;
    server.use(
      http.get('/api/einsaetze/7', () => {
        abrufe += 1;
        return abrufe === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json(
              einsatzFixture({
                id: 7,
                bezeichnung: 'Stadtfest',
                meine_rolle: 'beobachter',
                einsatzart: 'uebung',
              }),
            );
      }),
    );
    renderApp('/geraet/7/monitor');
    const leiste = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-lfh="monitor-statusleiste"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(await within(leiste).findByText('Einsatzart nicht geladen')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EINSATZKOPF_REFETCH_MS);
    });
    await waitFor(() => expect(leiste.querySelector('[data-lfh="uebung-marke"]')).not.toBeNull());
    expect(within(leiste).queryByText('Einsatzart nicht geladen')).toBeNull();
  });

  it('ein Realeinsatz trägt keine Übungsmarke (Gegenprobe)', async () => {
    bereit();
    renderApp('/geraet/7/monitor');
    expect(await screen.findByText('Stadtfest')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="uebung-marke"]')).toBeNull();
  });

  it('Kennzahlen sind mindestens 72 px, jeder Text mindestens 28 px', async () => {
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const zahlen = document.querySelectorAll<HTMLElement>('[data-lfh="monitor-zahl"]');
    expect(zahlen.length).toBeGreaterThan(5);
    for (const z of zahlen) {
      const [zahl, text] = z.children as unknown as HTMLElement[];
      expect(monitorPx(zahl.style.fontSize)).toBeGreaterThanOrEqual(72);
      expect(monitorPx(text.style.fontSize)).toBeGreaterThanOrEqual(28);
    }
  });

  it('Größen aus der Großbild-Skala, fest auf 1 px je Bezugspixel (LLH-1930)', async () => {
    bereit();
    renderApp('/geraet/7/monitor');
    const kachel = await screen.findByRole('region', { name: 'Betroffene' });
    // Der Monitor wächst nicht mit dem Fenster: seine Abstände stehen in Pixeln.
    const wurzel = document.querySelector<HTMLElement>('.lagemonitor');
    expect(wurzel?.style.getPropertyValue('--lfh-gross-einheit')).toBe('1px');
    expect(within(kachel).getByRole('heading', { name: 'Betroffene' }).style.fontSize).toBe(
      grossMass(GROSS_BEZUG.titel),
    );
    const [zahl, text] = kachel.querySelector('[data-lfh="monitor-zahl"]')!
      .children as unknown as HTMLElement[];
    expect(zahl.style.fontSize).toBe(grossMass(GROSS_BEZUG.zahl));
    expect(text.style.fontSize).toBe(grossMass(GROSS_BEZUG.text));
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
    // Der Hinweis steht sofort, die Kacheln erst mit den Zahlen.
    expect(await screen.findByRole('region', { name: 'Betroffene' })).toBeInTheDocument();
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
    // Mit `shouldAdvanceTime` läuft die Uhr auch, solange die erste Antwort unterwegs ist: der
    // Stand liegt etwas nach dem ersten Takt der Anzeige (10 s). Nach genau 3 min zeigte sie noch
    // „vor 2 min“, erst ihr nächster Takt sieht volle 3 min.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000 + 10_000);
    });
    expect(stand().getAttribute('data-veraltet')).toBe('ja');
    expect(stand().textContent).toMatch(/Veraltet · Stand .* · vor 3 min/);
  });

  it('nennt einen Stand über einer Stunde in Stunden und Minuten (anzeige/abstand.ts)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const stand = () => document.querySelector<HTMLElement>('[data-lfh="monitor-datenstand"]')!;
    lagebildAntwort = () => HttpResponse.json({ fehler: 'weg' }, { status: 503 });
    // Die Uhr springt, ohne dass die Abrufe dazwischen laufen; der Stand bleibt der erste.
    vi.setSystemTime(JETZT + 184 * 60_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(stand().textContent).toMatch(/Veraltet · Stand .* · vor 3 h 4 min$/);
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

/**
 * Spec `lagemonitor`, „Zahl der offenen Sofortmeldungen“ und „Neue Dringlichkeit sichtbar
 * hervorheben“ (Change `kcjecn9e-benachrichtigungskonzept`, D12): die Zahl kommt verdichtet vom
 * Server; steigt sie oder SK I gegenüber dem letzten Stand, ist sie 60 s hervorgehoben, mit Farbe
 * und Wort, ohne Blinken und ohne Ton.
 */
describe('Lagemonitor — offene Sofortmeldungen und neue Dringlichkeit', () => {
  const zahl = (region: string, bezeichnung: string) => {
    const kachel = screen.getByRole('region', { name: region });
    return within(kachel).getByText(bezeichnung).closest<HTMLElement>('[data-lfh="monitor-zahl"]')!;
  };
  const hervorgehoben = (region: string, bezeichnung: string) =>
    zahl(region, bezeichnung).getAttribute('data-hervorgehoben');
  /** Der nächste Abruf im Takt bringt `naechste`. */
  async function naechsterStand(naechste: LagemonitorAnzeige) {
    lagebildAntwort = () => HttpResponse.json(naechste);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ABRUF_TAKT_MS);
    });
  }

  it('Reihe Sanitätsdienst: „Hilfeleistungen“ statt „Betroffene“, SK I bleibt (LLH-1574)', async () => {
    bereit();
    lagebildAntwort = () =>
      HttpResponse.json({
        ...lage,
        sanitaetsdienst: {
          kontakte: 41,
          kontakte_letzte_stunde: 9,
          in_versorgung: 5,
          transporte: 3,
        },
      });
    renderApp('/geraet/7/monitor');
    const kachel = await screen.findByRole('region', { name: 'Hilfeleistungen' });
    expect(screen.queryByRole('region', { name: 'Betroffene' })).toBeNull();
    for (const [wert, wort] of [
      ['41', 'Kontakte'],
      ['9', 'letzte Stunde'],
      ['5', 'in Versorgung'],
      ['3', 'Transporte'],
    ]) {
      expect(within(kachel).getByText(wort).closest('[data-lfh="monitor-zahl"]')).toHaveTextContent(
        `${wert}${wort}`,
      );
    }
    expect(within(kachel).getByText('SK I')).toBeInTheDocument();
  });

  it('Alarmzeile (LLH-1743): Arten aus dem Block `alarm`, 28 px, ohne Bedienung', async () => {
    bereit();
    lagebildAntwort = () =>
      HttpResponse.json({
        ...lage,
        alarm: {
          sofort_offen: 1,
          dringend_offen: 0,
          bestaetigung_ueberfaellig: 0,
          auftraege_ueberfaellig: 1,
          erinnerungen_faellig: 0,
          nachforderungen_ueberfaellig: 0,
          rueckmeldung_ueberfaellig: [{ einheit: 'Logistiktrupp', seit_min: 47 }],
          abschnitte_kritisch: ['UHS Turnhalle'],
        },
      });
    renderApp('/geraet/7/monitor');
    const zeile = await screen.findByRole('status', { name: 'Was brennt' });
    await waitFor(() => expect(zeile).toHaveTextContent('kritisch: UHS Turnhalle'));
    expect(zeile.style.fontSize).toBe('28px');
    const arten = Array.from(zeile.querySelectorAll<HTMLElement>('[data-lfh="alarm-eintrag"]')).map(
      (e) => e.dataset.art,
    );
    // Folge wie in Überblick und Lagebild; die zwei Vermissten kommen aus `betroffene`.
    expect(arten.slice(0, 2)).toEqual(['sofort', 'vermisst']);
    expect(within(zeile).queryByRole('link')).toBeNull();
    expect(within(zeile).queryByRole('button')).toBeNull();
  });

  it('Alarmzeile: scheitert der Abruf, steht „Stand unvollständig“ statt „—“ (Review LLH-1743)', async () => {
    bereit();
    lagebildAntwort = () => HttpResponse.json({ error: 'kaputt' }, { status: 500 });
    renderApp('/geraet/7/monitor');
    const zeile = await screen.findByRole('status', { name: 'Was brennt' });
    await waitFor(() => expect(zeile).toHaveAttribute('data-stand', 'unvollstaendig'));
    expect(zeile).toHaveTextContent('Stand unvollständig');
  });

  it('Zwei offene Sofortmeldungen: „Sofortmeldungen offen 2“', async () => {
    bereit();
    lagebildAntwort = () => HttpResponse.json({ ...lage, sofortmeldungen_offen: 2 });
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    const meldungen = screen.getByRole('region', { name: 'Meldungen' });
    const z = within(meldungen).getByText('Sofortmeldungen offen');
    expect(z.closest('[data-lfh="monitor-zahl"]')).toHaveTextContent('2Sofortmeldungen offen');
    // Der erste Stand nach dem Laden ist kein Anstieg.
    expect(hervorgehoben('Meldungen', 'Sofortmeldungen offen')).toBe('nein');
  });

  it('Neue Sofortmeldung: 60 s hervorgehoben mit Wort, ohne Blinken und ohne Ton', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    renderApp('/geraet/7/monitor');
    // Die Kacheln rechts stehen erst mit dem ersten Stand.
    await screen.findByRole('region', { name: 'Betroffene' });
    expect(hervorgehoben('Meldungen', 'Sofortmeldungen offen')).toBe('nein');

    await naechsterStand({ ...lage, sofortmeldungen_offen: 1 });
    await waitFor(() => expect(hervorgehoben('Meldungen', 'Sofortmeldungen offen')).toBe('ja'));
    const meldungen = screen.getByRole('region', { name: 'Meldungen' });
    expect(within(meldungen).getByText('Neue Sofortmeldung')).toBeInTheDocument();
    const z = zahl('Meldungen', 'Sofortmeldungen offen');
    expect(z).toHaveTextContent('1Sofortmeldungen offen');
    // Kein Blinken: weder Animation noch Übergang.
    for (const el of [z, ...z.querySelectorAll<HTMLElement>('*')]) {
      expect(el.style.animation).toBe('');
      expect(el.style.transition).toBe('');
    }
    // SK I ist nicht gestiegen und bleibt ruhig.
    expect(hervorgehoben('Betroffene', 'SK I')).toBe('nein');

    // Der nächste gleiche Stand verlängert nicht, nach 60 s ist die Hervorhebung weg.
    await naechsterStand({ ...lage, sofortmeldungen_offen: 1 });
    expect(hervorgehoben('Meldungen', 'Sofortmeldungen offen')).toBe('ja');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HERVORHEBUNG_MS - ABRUF_TAKT_MS + 1_000);
    });
    expect(hervorgehoben('Meldungen', 'Sofortmeldungen offen')).toBe('nein');
    expect(within(meldungen).queryByText('Neue Sofortmeldung')).toBeNull();
    expect(spieleAlarmTon).not.toHaveBeenCalled();
  });

  it('Sofortmeldung bestätigt: sinkt die Zahl, entsteht keine Hervorhebung', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    lagebildAntwort = () => HttpResponse.json({ ...lage, sofortmeldungen_offen: 2 });
    renderApp('/geraet/7/monitor');
    // Die Kacheln rechts stehen erst mit dem ersten Stand.
    await screen.findByRole('region', { name: 'Betroffene' });

    await naechsterStand({ ...lage, sofortmeldungen_offen: 1 });
    await waitFor(() =>
      expect(zahl('Meldungen', 'Sofortmeldungen offen')).toHaveTextContent(
        '1Sofortmeldungen offen',
      ),
    );
    expect(hervorgehoben('Meldungen', 'Sofortmeldungen offen')).toBe('nein');
    expect(screen.queryByText('Neue Sofortmeldung')).toBeNull();
  });

  it('SK I steigt: hervorgehoben mit Wort; sinkt sie, nicht', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    expect(hervorgehoben('Betroffene', 'SK I')).toBe('nein');

    const mehr = { ...lage, betroffene: { ...lage.betroffene, sk1: 2 } };
    await naechsterStand(mehr);
    await waitFor(() => expect(hervorgehoben('Betroffene', 'SK I')).toBe('ja'));
    const betroffene = screen.getByRole('region', { name: 'Betroffene' });
    expect(within(betroffene).getByText('Neu in SK I')).toBeInTheDocument();
    expect(hervorgehoben('Meldungen', 'Sofortmeldungen offen')).toBe('nein');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HERVORHEBUNG_MS);
    });
    expect(hervorgehoben('Betroffene', 'SK I')).toBe('nein');

    await naechsterStand({ ...lage, betroffene: { ...lage.betroffene, sk1: 1 } });
    await waitFor(() => expect(zahl('Betroffene', 'SK I')).toHaveTextContent('1SK I'));
    expect(hervorgehoben('Betroffene', 'SK I')).toBe('nein');
    expect(within(betroffene).queryByText('Neu in SK I')).toBeNull();
    expect(spieleAlarmTon).not.toHaveBeenCalled();
  });

  it('der Monitor spielt keinen Ton, auch wenn sein Einsatzstrom alarmiert', async () => {
    bereit();
    renderApp('/geraet/7/monitor');
    // Die Kacheln rechts stehen erst mit dem ersten Stand.
    await screen.findByRole('region', { name: 'Betroffene' });
    const strom = FakeEventSource.instanzen.find(
      (q) => q.url === '/api/einsaetze/7/live' && !q.closed,
    );
    expect(strom, 'der Einsatzstrom des Monitors ist offen').toBeDefined();
    act(() => {
      strom!.emit('sofortmeldung', JSON.stringify({ einsatz_id: 7, meldung_id: 3 }));
      strom!.emit('abloesung', JSON.stringify({ einsatz_id: 7, art: 'faellig' }));
    });
    expect(spieleAlarmTon).not.toHaveBeenCalled();
  });
});

/**
 * Spec `lagemonitor`, „Überbelegte Unfallhilfsstelle in Alarmrolle“ (LLH-1746). Mutationsprobe:
 * ohne Vorrang der Überbelegten in der Sortierung → der zweite Fall rot (die Turnhalle fiele unter
 * „+2 weitere“); `>=` statt `>` in `istUeberbelegt` → der dritte Fall rot.
 */
describe('Lagemonitor — Überbelegung (LLH-1746)', () => {
  const uhs = (id: number, bezeichnung: string, belegt: number, plaetze: number) => ({
    id,
    bezeichnung,
    typ: 'behandlungsplatz' as const,
    status: 'aktiv' as const,
    lat: null,
    lon: null,
    belegt,
    plaetze,
    kraefte: 0,
  });
  async function belegungMit(liste: ReturnType<typeof uhs>[]) {
    bereit();
    lagebildAntwort = () => HttpResponse.json({ ...lage, uhs: liste });
    renderApp('/geraet/7/monitor');
    return screen.findByRole('region', { name: 'Belegung der Unfallhilfsstellen' });
  }
  const zahlVon = (kachel: HTMLElement, name: string) =>
    within(kachel).getByText(name).closest<HTMLElement>('[data-lfh="monitor-zahl"]')!;

  it('acht auf fünf: „8/5“ in der Alarmrolle, „1 überbelegt“ in der Titelzeile', async () => {
    const kachel = await belegungMit([uhs(1, 'UHS Turnhalle', 8, 5), uhs(2, 'UHS Nord', 3, 8)]);
    const turnhalle = zahlVon(kachel, 'UHS Turnhalle');
    expect(turnhalle).toHaveTextContent('8/5UHS Turnhalle');
    expect(turnhalle).toHaveAttribute('data-hervorgehoben', 'ja');
    expect(zahlVon(kachel, 'UHS Nord')).toHaveAttribute('data-hervorgehoben', 'nein');
    const zusatz = kachel.querySelector<HTMLElement>('[data-lfh="monitor-zusatz"]')!;
    expect(zusatz).toHaveTextContent('1 überbelegt');
    expect(zusatz.style.fontWeight).toBe('700');
  });

  it('eine kleine überbelegte UHS steht vor sieben größeren', async () => {
    const groessere = [3, 4, 5, 6, 7, 8, 9].map((id) => uhs(id, `UHS ${id}`, 10, 20));
    const kachel = await belegungMit([...groessere, uhs(1, 'UHS Turnhalle', 8, 5)]);
    const reihe = within(kachel)
      .getAllByText(/^UHS /)
      .map((e) => e.textContent);
    expect(reihe[0]).toBe('UHS Turnhalle');
    expect(within(kachel).getByText('+2 weitere')).toBeInTheDocument();
  });

  it('voll (5/5) und ohne Plätze sind nicht überbelegt', async () => {
    const kachel = await belegungMit([uhs(1, 'UHS Voll', 5, 5), uhs(2, 'UHS Zelt', 2, 0)]);
    expect(zahlVon(kachel, 'UHS Voll')).toHaveTextContent('5/5UHS Voll');
    expect(zahlVon(kachel, 'UHS Voll')).toHaveAttribute('data-hervorgehoben', 'nein');
    expect(zahlVon(kachel, 'UHS Zelt')).toHaveTextContent('2UHS Zelt');
    expect(zahlVon(kachel, 'UHS Zelt')).toHaveAttribute('data-hervorgehoben', 'nein');
    expect(kachel.querySelector('[data-lfh="monitor-zusatz"]')).toBeNull();
  });
});

describe('Lagemonitor — Ablauf der Veranstaltung (LLH-1570)', () => {
  // Je 30 s nach der vollen Minute: die Uhr läuft mit `shouldAdvanceTime` beim Laden ein paar
  // Sekunden weiter, der Abstand bleibt trotzdem auf der Minute.
  const programm = [
    { id: 1, bezeichnung: 'Beginn', zeitpunkt_at: '2026-10-04 10:20:30' },
    { id: 2, bezeichnung: 'Feuerwerk', zeitpunkt_at: '2026-10-04 11:05:30' },
    { id: 3, bezeichnung: 'Ende', zeitpunkt_at: '2026-10-04 12:00:30' },
  ];

  it('zeigt die nächsten Programmpunkte mit Abstand, ohne Alarm', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    lagebildAntwort = () => HttpResponse.json({ ...lage, programm });
    renderApp('/geraet/7/monitor');
    const ablauf = await screen.findByRole('region', { name: 'Ablauf' });
    const zeilen = within(ablauf).getAllByRole('listitem');
    expect(zeilen.map((z) => z.textContent)).toEqual([
      // Uhrzeit in der Anzeigezone (Europe/Berlin), dann Bezeichnung und Abstand.
      expect.stringMatching(/^12:?20Beginnin 20 min$/),
      expect.stringMatching(/Feuerwerkin 1 h 05 min$/),
      expect.stringMatching(/Endein 2 h 00 min$/),
    ]);
    expect(within(ablauf).queryByText(/überfällig/)).toBeNull();
    // Meldungen teilen sich die Zeile mit dem Ablauf.
    expect(screen.getByRole('region', { name: 'Meldungen' })).toBeInTheDocument();
  });

  it('ein verstrichener Programmpunkt fällt mit der Monitoruhr heraus, auch ohne Abruf', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: JETZT });
    bereit();
    lagebildAntwort = () => HttpResponse.json({ ...lage, programm });
    renderApp('/geraet/7/monitor');
    const ablauf = await screen.findByRole('region', { name: 'Ablauf' });
    expect(within(ablauf).getByText('Beginn')).toBeInTheDocument();
    // Der Server liefert weiter denselben Stand; die Uhr läuft über „Beginn“ hinaus.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000 + 40_000);
    });
    expect(within(ablauf).queryByText('Beginn')).toBeNull();
    expect(within(ablauf).getByText('Feuerwerk')).toBeInTheDocument();
  });

  it('ohne anstehenden Programmpunkt fehlt die Kachel', async () => {
    bereit();
    renderApp('/geraet/7/monitor');
    await screen.findByRole('region', { name: 'Betroffene' });
    expect(screen.queryByRole('region', { name: 'Ablauf' })).toBeNull();
  });
});

describe('Bausteine', () => {
  it('istVeraltet', () => {
    expect(istVeraltet(JETZT, JETZT + 2 * 60_000)).toBe(false);
    expect(istVeraltet(JETZT, JETZT + 2 * 60_000 + 1)).toBe(true);
    expect(istVeraltet(0, JETZT)).toBe(false);
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
