import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { DEFAULT_KONVENTIONEN, formatZeitKurz } from '../anzeige/format';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { modulRegistry } from '../einsatz/modulRegistry';
import StabPage from './StabPage';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

dayjs.extend(utc);

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

const nutzer = benutzerFixture({ org_rolle: 'fuehrungskraft' });
const einsatz = (over: object = {}) => ({
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  meine_sachgebiete: [],
  org_id: 5,
  begonnen_at: '2026-06-11 05:00:00',
  abgeschlossen_at: null,
  lagekennzahlen: [],
  ...over,
});

const leererStab = { besetzung: [] };
const label = (key: string) => modulRegistry.find((m) => m.key === key)!.label;

/**
 * Die Stab-Seite trägt seit LLH-1111 weder Vorbereitung noch Abschluss der Lagebesprechung — die
 * liegen auf der eigenen Seite (`LagebesprechungPage.test.tsx`). Deshalb hier keine Handler für
 * `…/lagebesprechung*` und keine Quellen der Vorbereitung: fragte die Seite sie doch an, scheiterte
 * der Abruf an `onUnhandledRequest: 'error'`.
 */
function rendere({
  einsatzObj = einsatz(),
  stab = leererStab as object,
  stabStatus = 200,
  freigaben = freigabenFixture(),
  route = '/einsaetze/1/stab',
} = {}) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      stabStatus === 200
        ? HttpResponse.json(stab)
        : HttpResponse.json({ error: 'kaputt' }, { status: stabStatus }),
    ),
    http.get('/api/einsaetze/1/stab/checkliste', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab" element={<StabPage />} />
    </Routes>,
    { route },
  );
}

async function besetzungsSektion() {
  return screen.findByRole('region', { name: 'Besetzung S1–S6' });
}

describe('StabPage', () => {
  it('trägt das Mandantenlabel aus dem Funktionskatalog (LFH-549)', async () => {
    server.use(
      http.get('/api/fuehrungsfunktionen', () =>
        HttpResponse.json([
          {
            funktion: 's4',
            kuerzel: 'S4',
            label: 'Versorgung (Logistik)',
            standard_label: 'Versorgung',
            art: 'sachgebiet',
            bezeichnung_pflicht: false,
          },
        ]),
      ),
    );
    rendere();
    const sektion = await besetzungsSektion();
    expect(
      await within(sektion).findByRole('heading', {
        level: 3,
        name: /S4 · Versorgung \(Logistik\)/,
      }),
    ).toBeInTheDocument();
  });

  it('zeigt sechs feste Zeilen auch ohne jede Besetzung', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    await waitFor(() =>
      expect(
        within(sektion)
          .getAllByRole('heading', { level: 3 })
          .map((h) => h.textContent),
      ).toEqual([
        expect.stringContaining('S1 · Personal'),
        expect.stringContaining('S2 · Lage'),
        expect.stringContaining('S3 · Einsatz'),
        expect.stringContaining('S4 · Versorgung'),
        expect.stringContaining('S5 · Presse- und Medienarbeit'),
        expect.stringContaining('S6 · Information und Kommunikation'),
      ]),
    );
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(6);
  });

  // LLH-1111: die Paneele „Lagebesprechung“ und „Vorbereitung“ sind auf die eigene Seite gezogen.
  it('hängt die Arbeitsaufnahme als letztes Paneel UNTER die Besetzung (LFH-551, LLH-1111)', async () => {
    rendere();
    await screen.findByRole('region', { name: 'Arbeitsaufnahme' });
    const regionen = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'));
    const namen = regionen.map((id) => document.getElementById(id ?? '')?.textContent);
    expect(namen).toEqual(['Besetzung S1–S6', 'Arbeitsaufnahme']);
  });

  it('sperrt die Haken der Arbeitsaufnahme ohne Schreibrecht; der Kopf nennt den Grund', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
    const r = await screen.findByRole('region', { name: 'Arbeitsaufnahme' });
    await waitFor(() => expect(within(r).getAllByRole('checkbox')).toHaveLength(7));
    for (const b of within(r).getAllByRole('checkbox')) expect(b).toBeDisabled();
    // Der Grund steht EINMAL im Kopf der Seite, nicht noch einmal im Paneel.
    expect(screen.getAllByText('Nur Ansicht')).toHaveLength(1);
    expect(within(r).queryByText('Nur Ansicht')).toBeNull();
  });

  it('nennt die Besetzung beim Wort', async () => {
    rendere({
      stab: {
        besetzung: [
          {
            sachgebiet: 's2',
            besetzung_art: 'personal',
            personal_id: 99,
            name: 'Müller',
            personal_noch_disponiert: true,
            gesetzt_at: '2026-09-13 10:00:00',
            gesetzt_von_id: 1,
          },
        ],
      },
    });
    const sektion = await besetzungsSektion();
    expect(await within(sektion).findByText('Müller')).toBeInTheDocument();
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(5);
  });

  describe('Rechte-Paar', () => {
    it('mit Schreibrecht: je Zeile „Besetzung ändern", kein Rechte-Hinweis', async () => {
      rendere();
      const sektion = await besetzungsSektion();
      await waitFor(() =>
        expect(
          within(sektion).getAllByRole('button', { name: /^Besetzung ändern – S\d/ }),
        ).toHaveLength(6),
      );
      expect(screen.queryByText(/können die Besetzung ändern/)).toBeNull();
    });

    it('als Beobachter: keine Zeilenaktion, der Grund steht auf der Seite', async () => {
      rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
      const sektion = await besetzungsSektion();
      expect(
        await screen.findByText('nur Einsatzleitung und Führungspersonal'),
      ).toBeInTheDocument();
      expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(
        0,
      );
    });

    it('im abgeschlossenen Einsatz: keine Zeilenaktion, Hinweis nennt den Abschluss', async () => {
      rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
      await besetzungsSektion();
      expect(await screen.findByText('Einsatz abgeschlossen')).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });
  });

  it('behauptet während des Ladens keine Besetzung', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      // Antwort bleibt aus: der Abruf steht dauerhaft auf „lädt".
      http.get('/api/einsaetze/1/stab', () => new Promise<never>(() => {})),
      http.get('/api/einsaetze/1/stab/checkliste', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<StabPage />} />
      </Routes>,
      { route: '/einsaetze/1/stab' },
    );
    const sektion = await besetzungsSektion();
    expect(within(sektion).getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(within(sektion).queryByText('nicht vergeben')).toBeNull();
    expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
  });

  it('Fehler ist nicht leer: ein gescheiterter Abruf behauptet keine sechs leeren Zeilen', async () => {
    rendere({ stabStatus: 500 });
    expect(
      await screen.findByText('Führungsorganisation konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('nicht vergeben')).toBeNull();
  });

  it('Werkzeug-Links zeigen nur freigegebene Module', async () => {
    rendere({ freigaben: freigabenFixture({ chat: { sichtbar: false } }) });
    await besetzungsSektion();
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    expect(within(s4).getByRole('link', { name: label('nachforderungen') })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    const s6 = screen.getByRole('group', { name: 'Werkzeuge S6' });
    // Vor der Antwort der Freigaben zeigt keine Zeile ein Modul-Werkzeug (unbekannt heißt nicht
    // frei). Erst positiv auf ein freies Werkzeug derselben Zeile warten — die Abwesenheit wäre
    // sonst trivial.
    expect(
      await within(s6).findByRole('link', { name: label('einsatzabschnitte') }),
    ).toBeInTheDocument();
    expect(within(s6).queryByRole('link', { name: label('chat') })).toBeNull();
  });

  it('die S6-Zeile führt zu Funkplan und Kommunikationsplan, keine andere Zeile (LFH-548, LFH-848)', async () => {
    rendere();
    await besetzungsSektion();
    const s6 = await screen.findByRole('group', { name: 'Werkzeuge S6' });
    expect(within(s6).getByRole('link', { name: 'Funkplan' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/funkplan',
    );
    expect(within(s6).getByRole('link', { name: 'Kommunikationsplan' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/kommunikationsplan',
    );
    expect(screen.getAllByRole('link', { name: 'Funkplan' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Kommunikationsplan' })).toHaveLength(1);
  });

  it('die S5-Zeile führt zu Pressearbeit und Informationstelefon, keine andere Zeile (LFH-554)', async () => {
    rendere();
    await besetzungsSektion();
    const s5 = await screen.findByRole('group', { name: 'Werkzeuge S5' });
    expect(within(s5).getByRole('link', { name: 'Pressearbeit' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/presse',
    );
    expect(within(s5).getByRole('link', { name: 'Informationstelefon' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/infotelefon',
    );
    expect(screen.getAllByRole('link', { name: 'Pressearbeit' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Informationstelefon' })).toHaveLength(1);
  });

  it('der Funkplan-Verweis bleibt, auch wenn alle Modul-Werkzeuge der S6 ausgeblendet sind', async () => {
    rendere({
      freigaben: freigabenFixture({
        chat: { sichtbar: false },
        einsatzabschnitte: { sichtbar: false },
      }),
    });
    await besetzungsSektion();
    // Anker: die Freigaben sind angekommen, sobald eine andere Zeile ihr Werkzeug zeigt.
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    expect(within(s4).getByRole('link', { name: label('nachforderungen') })).toBeInTheDocument();
    const s6 = screen.getByRole('group', { name: 'Werkzeuge S6' });
    expect(within(s6).queryByRole('link', { name: label('einsatzabschnitte') })).toBeNull();
    expect(within(s6).getByRole('link', { name: 'Funkplan' })).toBeInTheDocument();
  });

  it('„Besetzung ändern" öffnet die Maske der Zeile', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    const knopf = await within(sektion).findByRole('button', {
      name: 'Besetzung ändern – S4 Versorgung',
    });
    await userEvent.click(knopf);
    expect(await screen.findByText('Besetzung S4 · Versorgung')).toBeInTheDocument();
  });
});

/**
 * LLH-1111 (design.md D8): statt der Paneele „Lagebesprechung“ und „Vorbereitung“ steht oben eine
 * Zeile mit dem Termin aus dem Einsatzkopf und dem Sprung in das eigene Modul.
 */
describe('StabPage · Zeile „Nächste Lagebesprechung“ (LLH-1111)', () => {
  const JETZT = new Date('2026-09-13T10:00:00Z');
  const wireAb = (minuten: number) =>
    dayjs(JETZT).add(minuten, 'minute').utc().format('YYYY-MM-DD HH:mm:ss');
  const zeile = () => screen.findByRole('group', { name: 'Nächste Lagebesprechung' });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(JETZT);
  });
  afterEach(() => vi.useRealTimers());

  it('zeigt Termin und Zustand aus dem Einsatzkopf und springt in die Lagebesprechung', async () => {
    rendere({ einsatzObj: einsatz({ naechste_lagebesprechung_at: wireAb(25) }) });
    const z = await zeile();
    expect(z).toHaveTextContent(formatZeitKurz(wireAb(25), DEFAULT_KONVENTIONEN));
    expect(within(z).getByText('in 25 min')).toBeInTheDocument();
    expect(await within(z).findByRole('link', { name: 'Zur Lagebesprechung' })).toHaveAttribute(
      'href',
      '/einsaetze/1/lagebesprechung',
    );
  });

  it('ein überfälliger Termin heißt „seit 5 min überfällig“', async () => {
    rendere({ einsatzObj: einsatz({ naechste_lagebesprechung_at: wireAb(-5) }) });
    expect(await within(await zeile()).findByText('seit 5 min überfällig')).toBeInTheDocument();
  });

  it('ohne Termin im Einsatzkopf: „kein Termin“', async () => {
    rendere();
    expect(within(await zeile()).getByText('kein Termin')).toBeInTheDocument();
  });

  it('ohne Zugriff auf die Lagebesprechung: Termin ja, Sprung gesperrt mit Grund', async () => {
    rendere({
      einsatzObj: einsatz({ naechste_lagebesprechung_at: wireAb(25) }),
      freigaben: freigabenFixture({ lagebesprechung: { zugriff: false } }),
    });
    const z = await zeile();
    expect(within(z).getByText('in 25 min')).toBeInTheDocument();
    expect(
      await within(z).findByRole('button', { name: 'Zur Lagebesprechung (Keine Berechtigung)' }),
    ).toBeDisabled();
    expect(within(z).queryByRole('link', { name: 'Zur Lagebesprechung' })).toBeNull();
  });

  it('trägt weder Abschluss noch Vorbereitung der Lagebesprechung', async () => {
    rendere({ einsatzObj: einsatz({ naechste_lagebesprechung_at: wireAb(25) }) });
    // Positiv zuerst: Seite und Zeile stehen — sonst wären die Abwesenheiten trivial.
    await besetzungsSektion();
    await within(await zeile()).findByRole('link', { name: 'Zur Lagebesprechung' });
    expect(screen.queryByRole('button', { name: 'Lagebesprechung abschließen' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Vorbereitung' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Lagebesprechung' })).toBeNull();
  });

  it('öffnet mit ?neu=1 keine Maske mehr — die Schnellaktion zielt auf die eigene Seite', async () => {
    rendere({ route: '/einsaetze/1/stab?neu=1' });
    await besetzungsSektion();
    await zeile();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
