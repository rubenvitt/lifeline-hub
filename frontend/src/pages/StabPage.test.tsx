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
const LEER_SKIZZE = {
  lage: [],
  komponenten: [],
  verbindungen: [],
  bereiche: [],
  schriftfeld: {
    herausgeber: null,
    vs_vermerk: 'keiner',
    gueltig_ab: null,
    gez_name: null,
    gez_at: null,
  },
  stand: null,
};

function rendere({
  einsatzObj = einsatz(),
  stab = leererStab as object,
  stabStatus = 200,
  freigaben = freigabenFixture(),
  zaehler = {} as object,
  presse = {
    gesamt: 0,
    offen: 0,
    offene_anfragen: 0,
    je_art: { anfrage: 0, abstimmung: 0, termin: 0 },
    medien: [],
  } as object,
  route = '/einsaetze/1/stab',
} = {}) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      stabStatus === 0
        ? new Promise<never>(() => {})
        : stabStatus === 200
          ? HttpResponse.json(stab)
          : HttpResponse.json({ error: 'kaputt' }, { status: stabStatus }),
    ),
    http.get('/api/einsaetze/1/stab/checkliste', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
    // Die Quellen der Zahlen je Werkzeug (LLH-1124, design.md D4/D5).
    http.get('/api/einsaetze/1/modul-zaehler', () => HttpResponse.json(zaehler)),
    http.get('/api/einsaetze/1/stab/medienkontakte/kennzahlen', () => HttpResponse.json(presse)),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/stab/kommunikationsplan', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/stab/fernmeldeskizze', () => HttpResponse.json(LEER_SKIZZE)),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab" element={<StabPage />} />
    </Routes>,
    { route },
  );
}

/** Die Kachel eines Sachgebiets: ein Paneel, benannt nach Kennung und Label (design.md D1). */
function kachel(kuerzel: string) {
  return screen.findByRole('region', { name: new RegExp(`^${kuerzel} · `) });
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
    expect(
      await screen.findByRole('heading', { level: 2, name: 'S4 · Versorgung (Logistik)' }),
    ).toBeInTheDocument();
  });

  it('zeigt sechs Kacheln in fester Reihenfolge, auch ohne jede Besetzung (LLH-1124)', async () => {
    rendere();
    await kachel('S1');
    await waitFor(() => expect(screen.getAllByText('nicht vergeben')).toHaveLength(6));
    const regionen = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'));
    const namen = regionen.map((id) => document.getElementById(id ?? '')?.textContent);
    // Die Arbeitsaufnahme steht als letztes Paneel unter dem Raster (LFH-551, D6).
    expect(namen).toEqual([
      'S1 · Personal',
      'S2 · Lage',
      'S3 · Einsatz',
      'S4 · Versorgung',
      'S5 · Presse- und Medienarbeit',
      'S6 · Information und Kommunikation',
      'Arbeitsaufnahme',
    ]);
    for (const k of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
      expect(
        screen.getByRole('heading', { level: 2, name: new RegExp(`^${k} · `) }),
      ).toBeInTheDocument();
    }
  });

  it('nennt die Fundstelle sichtbar an jeder Kachel', async () => {
    rendere();
    const s3 = await kachel('S3');
    expect(within(s3).getByText('FwDV 100 Anl. 2, S. 57')).toBeInTheDocument();
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

  it('nennt die Besetzung beim Wort und den Besetzungsstand im Seitenkopf', async () => {
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
    const s2 = await kachel('S2');
    expect(await within(s2).findByText('Müller')).toBeInTheDocument();
    expect(screen.getAllByText('nicht vergeben')).toHaveLength(5);
    expect(screen.getByText('1/6 besetzt')).toBeInTheDocument();
  });

  describe('Rechte-Paar', () => {
    it('mit Schreibrecht: je Kachel „Besetzung ändern", kein Rechte-Hinweis', async () => {
      rendere();
      await kachel('S1');
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: /^Besetzung ändern – S\d/ })).toHaveLength(6),
      );
      expect(screen.queryByText(/können die Besetzung ändern/)).toBeNull();
    });

    it('als Beobachter: keine Kachelaktion, der Grund steht auf der Seite', async () => {
      rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
      await kachel('S1');
      expect(
        await screen.findByText('nur Einsatzleitung und Führungspersonal'),
      ).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });

    it('im abgeschlossenen Einsatz: keine Kachelaktion, Hinweis nennt den Abschluss', async () => {
      rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
      await kachel('S1');
      expect(await screen.findByText('Einsatz abgeschlossen')).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });
  });

  it('behauptet während des Ladens keine Besetzung', async () => {
    // Antwort bleibt aus: der Abruf steht dauerhaft auf „lädt".
    rendere({ stabStatus: 0 });
    await kachel('S1');
    expect(screen.getAllByRole('heading', { level: 2, name: /^S\d · / })).toHaveLength(6);
    expect(screen.queryByText('nicht vergeben')).toBeNull();
    expect(screen.queryByText(/besetzt$/)).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
  });

  it('Fehler ist nicht leer: ein gescheiterter Abruf behauptet keine sechs leeren Kacheln', async () => {
    rendere({ stabStatus: 500 });
    expect(
      await screen.findByText('Führungsorganisation konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('nicht vergeben')).toBeNull();
    expect(screen.queryByRole('region', { name: /^S1 · / })).toBeNull();
  });

  it('Werkzeuge: ausgeblendet fehlt, gesperrt steht mit Grund (design.md D2)', async () => {
    rendere({
      freigaben: freigabenFixture({
        verpflegung: { sichtbar: false },
        material: { zugriff: false },
      }),
    });
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    expect(await within(s4).findByRole('link', { name: label('nachforderungen') })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    expect(within(s4).queryByText(new RegExp(label('verpflegung')))).toBeNull();
    expect(
      within(s4).getByRole('button', { name: `${label('material')} (Keine Berechtigung)` }),
    ).toBeDisabled();
  });

  it('Nachforderungen stehen bei S1 und S4, ohne Zahl', async () => {
    rendere();
    for (const k of ['S1', 'S4']) {
      const g = await screen.findByRole('group', { name: `Werkzeuge ${k}` });
      expect(
        await within(g).findByRole('link', { name: label('nachforderungen') }),
      ).toHaveAttribute('href', '/einsaetze/1/nachforderungen');
    }
  });

  it('die S6-Kachel führt die vier Einstiege des Fernmeldewesens (LLH-1180, LLH-1124)', async () => {
    rendere();
    const s6 = await screen.findByRole('group', { name: 'Werkzeuge S6' });
    expect(await within(s6).findByRole('link', { name: /^Funkplan/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/fernmeldewesen',
    );
    expect(within(s6).getByRole('link', { name: 'Fernmeldeskizze' })).toHaveAttribute(
      'href',
      '/einsaetze/1/fernmeldewesen?ansicht=skizze',
    );
    expect(within(s6).getByRole('link', { name: 'Sprechgruppen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/fernmeldewesen?ansicht=sprechgruppen',
    );
    expect(within(s6).getByRole('link', { name: 'Kommunikationsplan' })).toHaveAttribute(
      'href',
      '/einsaetze/1/fernmeldewesen/kommunikationsplan',
    );
    expect(within(s6).queryByRole('link', { name: label('chat') })).toBeNull();
    expect(screen.getAllByRole('link', { name: /^Funkplan/ })).toHaveLength(1);
  });

  it('der Funkplan zählt die Lücken wie das Lücken-Paneel', async () => {
    rendere();
    const s6 = await screen.findByRole('group', { name: 'Werkzeuge S6' });
    // Ohne Daten bleibt nur die Leitstelle ohne Verbindung: eine Lücke.
    expect(await within(s6).findByRole('link', { name: 'Funkplan, 1, Lücke' })).toBeInTheDocument();
  });

  // LLH-1180, Spec `fernmeldewesen`: die S6-Sprünge erben die Sperre ihres Ziels.
  it('S6: bei gesperrtem Fernmeldewesen stehen alle vier Sprünge gesperrt mit Grund, ohne Zahl', async () => {
    rendere({ freigaben: freigabenFixture({ fernmeldewesen: { zugriff: false } }) });
    const s6 = await screen.findByRole('group', { name: 'Werkzeuge S6' });
    for (const name of ['Funkplan', 'Fernmeldeskizze', 'Sprechgruppen', 'Kommunikationsplan']) {
      expect(
        await within(s6).findByRole('button', { name: `${name} (Keine Berechtigung)` }),
      ).toBeDisabled();
    }
    expect(within(s6).queryByRole('link')).toBeNull();
  });

  it('S6: bei ausgeblendetem Fernmeldewesen fehlen die Sprünge', async () => {
    rendere({
      freigaben: freigabenFixture({ fernmeldewesen: { sichtbar: false, zugriff: false } }),
    });
    // Anker: die Freigaben sind angekommen, sobald eine andere Kachel ihr Werkzeug zeigt.
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    await within(s4).findByRole('link', { name: label('nachforderungen') });
    expect(screen.queryByRole('group', { name: 'Werkzeuge S6' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Funkplan/ })).toBeNull();
  });

  it('die S5-Kachel führt zu Pressearbeit und Informationstelefon, die Presse mit offenen Anfragen', async () => {
    rendere({
      presse: {
        gesamt: 3,
        offen: 2,
        offene_anfragen: 2,
        je_art: { anfrage: 2, abstimmung: 0, termin: 1 },
        medien: [],
      },
    });
    const s5 = await screen.findByRole('group', { name: 'Werkzeuge S5' });
    expect(
      await within(s5).findByRole('link', { name: 'Pressearbeit, 2, offene Anfragen' }),
    ).toHaveAttribute('href', '/einsaetze/1/stab/presse');
    expect(within(s5).getByRole('link', { name: 'Informationstelefon' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/infotelefon',
    );
  });

  it('Aufträge zeigen die Zahl des Modulzählers, überfällige als Achtung mit Wort', async () => {
    rendere({ zaehler: { auftraege: { offen: 2, in_arbeit: 0, ueberfaellig: 1 } } });
    const s3 = await screen.findByRole('group', { name: 'Werkzeuge S3' });
    const link = await within(s3).findByRole('link', {
      name: `${label('auftraege')}, 2, 1 überfällig`,
    });
    expect(link).toHaveAttribute('data-ton', 'achtung');
    // Fehlt ein Feld in der Antwort, steht „—“ mit Grund, nie 0.
    expect(
      within(s3).getByRole('link', { name: `${label('einsatzabschnitte')}, —, nicht freigegeben` }),
    ).toBeInTheDocument();
  });

  it('„Besetzung ändern" öffnet die Maske der Kachel', async () => {
    rendere();
    const s4 = await kachel('S4');
    const knopf = await within(s4).findByRole('button', {
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
    await kachel('S1');
    await within(await zeile()).findByRole('link', { name: 'Zur Lagebesprechung' });
    expect(screen.queryByRole('button', { name: 'Lagebesprechung abschließen' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Vorbereitung' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Lagebesprechung' })).toBeNull();
  });

  it('öffnet mit ?neu=1 keine Maske mehr — die Schnellaktion zielt auf die eigene Seite', async () => {
    rendere({ route: '/einsaetze/1/stab?neu=1' });
    await kachel('S1');
    await zeile();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
