import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { einsatzKeys } from '../api/queryKeys';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { modulRegistry } from '../einsatz/modulRegistry';
import StabPage from './StabPage';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

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

/** Quellen der Vorbereitung (LFH-550): dieselben Listen wie das Lage-Dashboard, plus Zähler. */
interface Lagequellen {
  personen?: object[];
  personenStatus?: number;
  personal?: object[];
  zaehler?: object;
}
const ZAEHLER = {
  auftraege: { offen: 5, in_arbeit: 2, ueberfaellig: 1 },
  meldungen: { offen: 3, ungesehen: 1, bestaetigung_ueberfaellig: 0 },
};
const leererStab = { anzahl_lagebesprechungen: 0, besetzung: [] };
const label = (key: string) => modulRegistry.find((m) => m.key === key)!.label;
const GRUND = 'Einsatz ist abgeschlossen und schreibgeschützt';

function Ort() {
  const ort = useLocation();
  return <output aria-label="Ort">{ort.pathname + ort.search}</output>;
}

function rendere({
  einsatzObj = einsatz(),
  stab = leererStab as object,
  stabStatus = 200,
  freigaben = freigabenFixture(),
  route = '/einsaetze/1/stab',
  post = () => HttpResponse.json(leererStab, { status: 201 }) as Response,
  lage = {} as Lagequellen,
} = {}) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      stabStatus === 200
        ? HttpResponse.json(stab)
        : HttpResponse.json({ error: 'kaputt' }, { status: stabStatus }),
    ),
    http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/stab/checkliste', () => HttpResponse.json([])),
    http.post('/api/einsaetze/1/stab/lagebesprechungen', () => post()),
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json(lage.personal ?? [])),
    http.get('/api/einsaetze/1/personen', () =>
      lage.personenStatus
        ? HttpResponse.json({ error: 'gesperrt' }, { status: lage.personenStatus })
        : HttpResponse.json(lage.personen ?? []),
    ),
    ...['uhs', 'schaeden', 'gefahrengebiete', 'lageberichte', 'einheiten', 'fahrzeuge'].map((l) =>
      http.get(`/api/einsaetze/1/${l}`, () => HttpResponse.json([])),
    ),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/modul-zaehler', () => HttpResponse.json(lage.zaehler ?? ZAEHLER)),
  );
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/stab"
        element={
          <>
            <StabPage />
            <Ort />
          </>
        }
      />
      <Route path="/einsaetze/:id/lageberichte/:lbId" element={<Ort />} />
    </Routes>,
    { route },
  );
}

async function besetzungsSektion() {
  return screen.findByRole('region', { name: 'Besetzung S1–S6' });
}
async function lagebesprechungSektion() {
  return screen.findByRole('region', { name: 'Lagebesprechung' });
}
const kopfaktion = () => screen.findByRole('button', { name: 'Lagebesprechung abschließen' });
/** Primäraktionen IM Kopf — derselbe Zuschnitt wie die Dev-Warnung von `EinsatzSeite`. */
function primaerImKopf(): number {
  const kopf = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
  return [...(kopf?.querySelectorAll('button') ?? [])].filter((b) =>
    [...b.classList].some((k) => k.endsWith('-btn-primary')),
  ).length;
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
        level: 4,
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
          .getAllByRole('heading', { level: 4 })
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

  it('hängt die Arbeitsaufnahme als letztes Paneel UNTER die bestehenden (LFH-551, LFH-550)', async () => {
    rendere();
    await screen.findByRole('region', { name: 'Arbeitsaufnahme' });
    const regionen = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'));
    const namen = regionen.map((id) => document.getElementById(id ?? '')?.textContent);
    expect(namen).toEqual([
      'Lagebesprechung',
      'Vorbereitung',
      'Besetzung S1–S6',
      'Arbeitsaufnahme',
    ]);
  });

  it('sperrt die Haken der Arbeitsaufnahme ohne Schreibrecht; der Kopf nennt den Grund', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
    const r = await screen.findByRole('region', { name: 'Arbeitsaufnahme' });
    await waitFor(() => expect(within(r).getAllByRole('checkbox')).toHaveLength(7));
    for (const b of within(r).getAllByRole('checkbox')) expect(b).toBeDisabled();
    // Der Grund steht EINMAL im Kopf der Seite, nicht noch einmal im Paneel.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(within(r).queryByRole('alert')).toBeNull();
  });

  it('nennt die Besetzung beim Wort', async () => {
    rendere({
      stab: {
        anzahl_lagebesprechungen: 0,
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
        await screen.findByText(/Nur Einsatzleitung und Führungspersonal/),
      ).toBeInTheDocument();
      expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(
        0,
      );
    });

    it('im abgeschlossenen Einsatz: keine Zeilenaktion, Hinweis nennt den Abschluss', async () => {
      rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
      await besetzungsSektion();
      expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });
  });

  it('behauptet während des Ladens keine Besetzung und keinen Termin, sperrt die Kopfaktion', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      // Antwort bleibt aus: der Abruf steht dauerhaft auf „lädt".
      http.get('/api/einsaetze/1/stab', () => new Promise<never>(() => {})),
      http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<StabPage />} />
      </Routes>,
      { route: '/einsaetze/1/stab' },
    );
    const sektion = await besetzungsSektion();
    expect(within(sektion).getAllByRole('heading', { level: 4 })).toHaveLength(6);
    expect(within(sektion).queryByText('nicht vergeben')).toBeNull();
    expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    // Ohne Stand fehlte der Termin zur Vorbelegung — gesperrt (Gegenfall: Kopfaktion-Test unten).
    expect(await kopfaktion()).toBeDisabled();
    expect(within(await lagebesprechungSektion()).queryByText('kein Termin')).toBeNull();
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

  it('die S6-Zeile führt zum Funkplan, keine andere Zeile (LFH-548)', async () => {
    rendere();
    await besetzungsSektion();
    const s6 = await screen.findByRole('group', { name: 'Werkzeuge S6' });
    expect(within(s6).getByRole('link', { name: 'Funkplan' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/funkplan',
    );
    expect(screen.getAllByRole('link', { name: 'Funkplan' })).toHaveLength(1);
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

describe('StabPage · Sektion Lagebesprechung', () => {
  it('zeigt den Stand und die leere Historie', async () => {
    rendere();
    const sektion = await lagebesprechungSektion();
    expect(await within(sektion).findByText('kein Termin')).toBeInTheDocument();
    expect(
      await within(sektion).findByText('Noch keine Lagebesprechung abgeschlossen'),
    ).toBeInTheDocument();
  });

  it('Fehler ist nicht leer: ohne Stand kein „kein Termin"', async () => {
    rendere({ stabStatus: 500 });
    const sektion = await lagebesprechungSektion();
    expect(
      await within(sektion).findByText('Stand der Lagebesprechung konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(within(sektion).queryByText('kein Termin')).toBeNull();
  });
});

describe('StabPage · Kopfaktion „Lagebesprechung abschließen"', () => {
  it('ist mit Schreibrecht die eine Primäraktion und öffnet die Maske', async () => {
    rendere();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());
    expect(primaerImKopf()).toBe(1);
    await userEvent.click(knopf);
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
  });

  it('ist als Beobachter gesperrt statt versteckt, der Hinweis nennt den Grund', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
    expect(await screen.findByText(/Lagebesprechungen abschließen/)).toBeInTheDocument();
    expect(await kopfaktion()).toBeDisabled();
    expect(primaerImKopf()).toBe(1);
  });

  it('ist im abgeschlossenen Einsatz gesperrt', async () => {
    rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
    await screen.findByText(/Der Einsatz ist abgeschlossen/);
    expect(await kopfaktion()).toBeDisabled();
  });

  /**
   * Ohne Stand fehlte der Termin zur Vorbelegung. Die Positivhälfte steht davor (Schreibrecht
   * besteht) und dahinter (der Stand kommt an → frei) — sonst wäre „gesperrt" aus dem falschen
   * Grund richtig.
   */
  it('ist bei dauerhaft gescheitertem Stand gesperrt, ohne eigenen Hinweis', async () => {
    rendere({ stabStatus: 500 });
    const sektion = await lagebesprechungSektion();
    expect(
      await within(sektion).findByText('Stand der Lagebesprechung konnte nicht geladen werden'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Nur Einsatzleitung/)).toBeNull());
    expect(await kopfaktion()).toBeDisabled();

    server.use(http.get('/api/einsaetze/1/stab', () => HttpResponse.json(leererStab)));
    await userEvent.click(within(sektion).getByRole('button', { name: /Wiederholen|Erneut/ }));
    await waitFor(async () => expect(await kopfaktion()).toBeEnabled());
  });

  /**
   * Fallen die Rechte bei offener Maske weg, ist sie weg — und sie steht nicht wieder auf, wenn die
   * Rechte zurückkommen. Die Positivhälfte (Kopfaktion wieder frei) steht vor der Negativaussage:
   * ohne sie belegte „kein Dialog" nur eine gesperrte Seite.
   */
  it('schließt die Maske beim Rechteverlust und öffnet sie danach nicht von selbst', async () => {
    const { client } = rendere();
    const u = userEvent.setup();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());
    await u.click(knopf);
    await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz({ status: 'abgeschlossen' }))),
    );
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
    expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    server.use(http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())));
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
    await waitFor(async () => expect(await kopfaktion()).toBeEnabled());
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  /**
   * Öffnen = Montieren, jede Öffnung hat eine frische Mutation. Die Maske wird beim Schließen
   * ausgehängt (nicht `open=false`) — deshalb darf auf das Verschwinden des Dialogs gewartet
   * werden. Stünde der Dialog noch in der Verlassen-Bewegung, auf `ant-zoom-leave` umstellen
   * (Muster `LageberichtDetailPage.test.tsx`).
   */
  it('öffnet nach einem Fehler ohne den Grund des vorigen Versuchs', async () => {
    rendere({ post: () => HttpResponse.json({ error: GRUND }, { status: 409 }) as Response });
    const u = userEvent.setup();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());

    await u.click(knopf);
    const erster = await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
    await u.type(within(erster).getByLabelText('Entschluss'), 'Lage unverändert');
    await u.click(within(erster).getByRole('button', { name: 'Abschließen' }));
    expect(await within(erster).findByText(GRUND)).toBeInTheDocument();

    await u.click(within(erster).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    await u.click(knopf);
    const zweiter = await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
    expect(within(zweiter).queryByText(GRUND)).toBeNull();
  });
});

describe('StabPage · ?neu=1 (Schnellaktion)', () => {
  const ort = () => screen.getByRole('status', { name: 'Ort' });

  it('öffnet die Maske mit Schreibrecht und räumt den Parameter', async () => {
    rendere({ route: '/einsaetze/1/stab?neu=1' });
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/stab$/));
  });

  it('öffnet als Beobachter keine Maske, räumt den Parameter aber trotzdem', async () => {
    rendere({
      einsatzObj: einsatz({ meine_rolle: 'beobachter' }),
      route: '/einsaetze/1/stab?neu=1',
    });
    // Positiv zuerst: der Leser ist gelaufen. Sonst wäre das `null` unten trivial.
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/stab$/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('StabPage · Vorbereitung der Lagebesprechung (LFH-550)', () => {
  const paneel = () => screen.findByRole('region', { name: 'Vorbereitung' });
  const zeile = (p: HTMLElement, schluessel: string) =>
    p.querySelector<HTMLElement>(
      `[data-lfh="vorbereitung-zeile"][data-schluessel="${schluessel}"]`,
    )!;
  const person = (id: number, over: object = {}) => ({
    id,
    status: 'erfasst',
    aktuelle_sichtung: null,
    erfasst_at: '2026-06-11 06:00:00',
    ...over,
  });

  it('zeigt den Lagestand mit Quelle je Zeile — Aufträge und Meldungen vom Modulzähler', async () => {
    rendere({ lage: { personen: [person(1), person(2, { status: 'vermisst' })] } });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'betroffene')).toHaveTextContent('2'));
    expect(zeile(p, 'betroffene')).toHaveTextContent('Quelle: Personen');
    expect(zeile(p, 'vermisste')).toHaveTextContent('1');
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    expect(zeile(p, 'auftraege')).toHaveTextContent('1 überfällig');
    expect(zeile(p, 'meldungen')).toHaveTextContent('3');
    expect(zeile(p, 'meldungen')).toHaveTextContent('Quelle: Meldungen (eingehend)');
  });

  it('aktualisiert sich live, ohne Neuladen', async () => {
    let offen = 3;
    const { client } = rendere({});
    server.use(
      http.get('/api/einsaetze/1/modul-zaehler', () =>
        HttpResponse.json({ ...ZAEHLER, meldungen: { ...ZAEHLER.meldungen, offen } }),
      ),
    );
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'meldungen')).toHaveTextContent('3'));
    offen = 4;
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.modulZaehler(1) }));
    await waitFor(() => expect(zeile(p, 'meldungen')).toHaveTextContent('4'));
  });

  it('eine gesperrte Quelle steht als „—“ mit Grund, nie als 0; der Rest bleibt', async () => {
    rendere({ lage: { personenStatus: 403 } });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'betroffene')).toHaveTextContent('nicht freigegeben'));
    expect(zeile(p, 'betroffene')).toHaveTextContent('—');
    expect(zeile(p, 'betroffene')).not.toHaveTextContent(/\b0\b/);
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
  });

  it('„In Lagebericht übernehmen“ legt EINEN Freitext-Bericht an und öffnet ihn', async () => {
    const anfragen: Array<Record<string, unknown>> = [];
    rendere({ lage: { personen: [person(1)] } });
    server.use(
      http.post('/api/einsaetze/1/lageberichte', async ({ request }) => {
        anfragen.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 77 }, { status: 201 });
      }),
    );
    const p = await paneel();
    const knopf = await within(p).findByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent(
        '/einsaetze/1/lageberichte/77',
      ),
    );
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0]).toMatchObject({ vorlage: 'freitext' });
    expect(String(anfragen[0].titel)).toMatch(/^Vorbereitung Lagebesprechung \d{6}[A-Z]{3}\d{4}$/);
    const text = (anfragen[0].abschnitte as Array<{ schluessel: string; text: string }>)[0];
    expect(text.schluessel).toBe('text');
    expect(text.text).toContain('**Stand:**');
    expect(text.text).toContain('- **Betroffene:** 1');
    expect(text.text).toContain('Quelle: Personen');
  });

  it('scheitert die Übernahme, steht der Fehler an der Seite, und es geht nicht weiter', async () => {
    rendere({});
    server.use(
      http.post('/api/einsaetze/1/lageberichte', () =>
        HttpResponse.json({ error: 'abgelehnt' }, { status: 422 }),
      ),
    );
    const p = await paneel();
    const knopf = await within(p).findByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    expect(await within(p).findByText('Nicht in den Lagebericht übernommen')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent(/^\/einsaetze\/1\/stab$/);
  });

  it('ohne Schreibrecht: Lagestand ja, Übernahme nein', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    expect(within(p).queryByRole('button', { name: 'In Lagebericht übernehmen' })).toBeNull();
  });

  it('ohne Freigabe der Lageberichte fehlt die Übernahme', async () => {
    rendere({ freigaben: freigabenFixture({ lageberichte: { sichtbar: false } }) });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    expect(within(p).queryByRole('button', { name: 'In Lagebericht übernehmen' })).toBeNull();
  });
});
