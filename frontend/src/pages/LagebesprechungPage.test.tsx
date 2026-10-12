import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { DEFAULT_KONVENTIONEN, formatUhrzeitMitTag, formatZeitKurz } from '../anzeige/format';
import { einsatzKeys } from '../api/queryKeys';
import type { Lagebesprechung, LagebesprechungStand } from '../api/types';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LagebesprechungPage from './LagebesprechungPage';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

/**
 * Seite „Lagebesprechung“ (LLH-1111): Termin, Vorbereitung (LFH-550), Abschluss und Verlauf — aus
 * der Stab-Seite herausgelöst. Die Seite fragt den Stab nie an: es gibt hier keinen Handler für
 * `/api/einsaetze/1/stab`, ein Abruf scheiterte an `onUnhandledRequest: 'error'`.
 */

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
  /** Zählt die Abrufe der modulgebundenen Listen (Schlüssel = letzter Pfadteil, LFH-669). */
  abrufe?: Record<string, number>;
}
const ZAEHLER = {
  auftraege: { offen: 5, in_arbeit: 2, ueberfaellig: 1 },
  meldungen: { offen: 3, ungesehen: 1, bestaetigung_ueberfaellig: 0 },
};
const leererStand: LagebesprechungStand = { anzahl_lagebesprechungen: 0 };
const GRUND = 'Einsatz ist abgeschlossen und schreibgeschützt';

const besprechung = (over: Partial<Lagebesprechung> = {}): Lagebesprechung => ({
  id: 2,
  einsatz_id: 1,
  lfd_nr: 2,
  abgehalten_at: '2026-06-11 08:00:00',
  entschluss: 'Lage unverändert',
  naechste_at: '2026-06-11 09:00:00',
  etb_eintrag_id: 77,
  erfasst_von_id: 1,
  erfasst_at: '2026-06-11 08:00:05',
  ...over,
});
/** Zwei abgeschlossene, die letzte mit Termin — für Vorbereitung und Verlauf. */
const ZWEI_VERLAUF = [
  besprechung(),
  besprechung({
    id: 1,
    lfd_nr: 1,
    abgehalten_at: '2026-06-11 07:00:00',
    naechste_at: '2026-06-11 08:00:00',
    etb_eintrag_id: 66,
  }),
];
const zweiStand: LagebesprechungStand = {
  anzahl_lagebesprechungen: 2,
  letzte_lagebesprechung: ZWEI_VERLAUF[0],
  naechste_lagebesprechung_at: '2026-06-11 09:00:00',
};

function Ort() {
  const ort = useLocation();
  return <output aria-label="Ort">{ort.pathname + ort.search}</output>;
}

function rendere({
  einsatzObj = einsatz(),
  stand = leererStand as LagebesprechungStand,
  /** `'haengt'` = antwortet nie. */
  standStatus = 200 as number | 'haengt',
  verlauf = [] as Lagebesprechung[],
  /** `'haengt'` = antwortet nie, `'fehler'` = 500 (Freigaben unbekannt, LFH-669). */
  freigaben = freigabenFixture() as ReturnType<typeof freigabenFixture> | 'haengt' | 'fehler',
  route = '/einsaetze/1/lagebesprechung',
  post = () => HttpResponse.json(leererStand, { status: 201 }) as Response,
  lage = {} as Lagequellen,
} = {}) {
  const zaehle = (liste: string) => {
    if (lage.abrufe) lage.abrufe[liste] = (lage.abrufe[liste] ?? 0) + 1;
  };
  const termine: Array<Record<string, unknown>> = [];
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/lagebesprechung', () => {
      if (standStatus === 'haengt') return new Promise<Response>(() => {});
      return standStatus === 200
        ? HttpResponse.json(stand)
        : HttpResponse.json({ error: 'kaputt' }, { status: standStatus });
    }),
    http.get('/api/einsaetze/1/lagebesprechungen', () => HttpResponse.json(verlauf)),
    http.post('/api/einsaetze/1/lagebesprechungen', () => post()),
    http.put('/api/einsaetze/1/lagebesprechung/termin', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      termine.push(body);
      return HttpResponse.json({ ...stand, naechste_lagebesprechung_at: body.naechste_at });
    }),
    http.get('/api/einsaetze/1/modul-freigaben', () => {
      if (freigaben === 'haengt') return new Promise<Response>(() => {});
      if (freigaben === 'fehler') return new HttpResponse(null, { status: 500 });
      return HttpResponse.json(freigaben);
    }),
    http.get('/api/einsaetze/1/personal', () => {
      zaehle('personal');
      return HttpResponse.json(lage.personal ?? []);
    }),
    http.get('/api/einsaetze/1/personen', () => {
      zaehle('personen');
      return lage.personenStatus
        ? HttpResponse.json({ error: 'gesperrt' }, { status: lage.personenStatus })
        : HttpResponse.json(lage.personen ?? []);
    }),
    ...[
      'uhs',
      'schaeden',
      'gefahrengebiete',
      'lageberichte',
      'einheiten',
      'fahrzeuge',
      'material',
      'abschnitte',
    ].map((l) =>
      http.get(`/api/einsaetze/1/${l}`, () => {
        zaehle(l);
        return HttpResponse.json([]);
      }),
    ),
    http.get('/api/einsaetze/1/modul-zaehler', () => HttpResponse.json(lage.zaehler ?? ZAEHLER)),
  );
  const ergebnis = renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/lagebesprechung"
        element={
          <>
            <LagebesprechungPage />
            <Ort />
          </>
        }
      />
      <Route path="/einsaetze/:id/lageberichte/:lbId" element={<Ort />} />
    </Routes>,
    { route },
  );
  return { ...ergebnis, termine };
}

const terminPaneel = () => screen.findByRole('region', { name: 'Termin' });
const verlaufPaneel = () => screen.findByRole('region', { name: 'Verlauf' });
const vorbereitungPaneel = () => screen.findByRole('region', { name: 'Vorbereitung' });
const kopfaktion = () => screen.findByRole('button', { name: 'Lagebesprechung abschließen' });
const STAND_FEHLER = 'Stand der Lagebesprechung konnte nicht geladen werden';
/** Primäraktionen IM Kopf — derselbe Zuschnitt wie die Dev-Warnung von `EinsatzSeite`. */
function primaerImKopf(): number {
  const kopf = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
  return [...(kopf?.querySelectorAll('button') ?? [])].filter((b) =>
    [...b.classList].some((k) => k.endsWith('-btn-primary')),
  ).length;
}
const vorbereitungZeile = (p: HTMLElement, schluessel: string) =>
  p.querySelector<HTMLElement>(`[data-lfh="vorbereitung-zeile"][data-schluessel="${schluessel}"]`)!;
const SCHNELLWAHL = ['+30 min', '+1 h', '+2 h'] as const;

describe('LagebesprechungPage · Aufbau', () => {
  it('trägt den Modulnamen als Titel und die Paneele Termin, Vorbereitung, Verlauf', async () => {
    rendere();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lagebesprechung' }),
    ).toBeInTheDocument();
    await verlaufPaneel();
    const regionen = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'));
    const namen = regionen.map((id) => document.getElementById(id ?? '')?.textContent);
    expect(namen).toEqual(['Termin', 'Vorbereitung', 'Verlauf']);
  });

  it('der Verlauf nennt die Zahl als Meta und zeigt alle Einträge', async () => {
    rendere({ stand: zweiStand, verlauf: ZWEI_VERLAUF });
    const verlauf = await verlaufPaneel();
    await waitFor(() =>
      expect(verlauf.querySelector('[data-lfh="paneel-meta"]')).toHaveTextContent(
        '2 abgeschlossen',
      ),
    );
    await waitFor(() =>
      expect(
        within(verlauf)
          .getAllByRole('heading', { level: 3 })
          .map((h) => h.textContent),
      ).toEqual([expect.stringContaining('Nr. 2'), expect.stringContaining('Nr. 1')]),
    );
  });

  it('ohne Besprechung: „kein Termin“ und „noch keine“, der Verlauf hat seinen Leertext', async () => {
    const { client } = rendere();
    const termin = await terminPaneel();
    expect(await within(termin).findByText('noch keine')).toBeInTheDocument();
    // An der Notiz, nicht über den Text: der Knopf „kein Termin“ steht auch ohne Stand da.
    expect(termin.querySelector('[data-lfh="kennzahl-notiz"]')).toHaveTextContent('kein Termin');
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.lagebesprechungen(1))?.status).toBe('success'),
    );
    const verlauf = await verlaufPaneel();
    expect(
      within(verlauf).getByText('Noch keine Lagebesprechung abgeschlossen'),
    ).toBeInTheDocument();
    expect(verlauf.querySelector('[data-lfh="paneel-meta"]')).toHaveTextContent('0 abgeschlossen');
  });

  it('Fehler ist nicht leer: ohne Stand kein „kein Termin“ und keine Schnellwahl', async () => {
    rendere({ standStatus: 500 });
    expect(await screen.findByText(STAND_FEHLER)).toBeInTheDocument();
    expect(screen.queryByText('kein Termin')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Termin' })).toBeNull();
    // Die Vorbereitung bleibt und nennt die Lücke statt eines Werts.
    const p = await vorbereitungPaneel();
    await waitFor(() =>
      expect(vorbereitungZeile(p, 'termin')).toHaveAttribute('data-zustand', 'fehler'),
    );
    expect(vorbereitungZeile(p, 'termin')).toHaveTextContent('—');
  });

  it('der Termin aus dem Paneel geht per PUT hinaus und steht danach in der Seite', async () => {
    const { termine } = rendere();
    const termin = await terminPaneel();
    const knopf = within(termin).getByRole('button', { name: '+1 h' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(termine).toHaveLength(1));
    expect(termine[0].naechste_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // Die Antwort ersetzt den Stand (`setQueryData`): der Zustand steht nicht mehr auf „kein Termin“.
    await waitFor(() =>
      expect(termin.querySelector('[data-lfh="kennzahl-notiz"]')?.textContent ?? '').toMatch(
        /^in /,
      ),
    );
  });
});

describe('LagebesprechungPage · Rechte', () => {
  it('Beobachter sieht Termin, Vorbereitung und Verlauf; Primäraktion und Schnellwahl gesperrt', async () => {
    rendere({
      einsatzObj: einsatz({ meine_rolle: 'beobachter' }),
      stand: zweiStand,
      verlauf: ZWEI_VERLAUF,
    });
    expect(await screen.findByText('Nur Ansicht')).toBeInTheDocument();
    const termin = await terminPaneel();
    const p = await vorbereitungPaneel();
    const verlauf = await verlaufPaneel();
    await waitFor(() =>
      expect(termin).toHaveTextContent(formatZeitKurz('2026-06-11 09:00:00', DEFAULT_KONVENTIONEN)),
    );
    await waitFor(() => expect(vorbereitungZeile(p, 'besprechung')).toHaveTextContent('Nr. 2'));
    expect(await within(verlauf).findByText(/Nr\. 1/)).toBeInTheDocument();
    expect(await kopfaktion()).toBeDisabled();
    expect(primaerImKopf()).toBe(1);
    for (const name of [...SCHNELLWAHL, 'kein Termin']) {
      expect(within(termin).getByRole('button', { name })).toBeDisabled();
    }
    expect(within(termin).getByLabelText('Termin wählen')).toBeDisabled();
  });

  it('mit gesperrtem Stab arbeitet die Seite voll — es gilt nur die eigene Freigabe', async () => {
    rendere({
      stand: zweiStand,
      verlauf: ZWEI_VERLAUF,
      freigaben: freigabenFixture({ stab: { sichtbar: false, zugriff: false } }),
    });
    const termin = await terminPaneel();
    const p = await vorbereitungPaneel();
    await waitFor(() => expect(vorbereitungZeile(p, 'besprechung')).toHaveTextContent('Nr. 2'));
    expect(vorbereitungZeile(p, 'besprechung')).toHaveAttribute('data-zustand', 'daten');
    expect(vorbereitungZeile(p, 'termin')).toHaveAttribute('data-zustand', 'daten');
    for (const name of SCHNELLWAHL) {
      expect(within(termin).getByRole('button', { name })).toBeEnabled();
    }
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
  });
});

describe('LagebesprechungPage · Kopfaktion „Lagebesprechung abschließen"', () => {
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
    expect(await screen.findByText('Nur Ansicht')).toBeInTheDocument();
    expect(await kopfaktion()).toBeDisabled();
    expect(primaerImKopf()).toBe(1);
  });

  it('ist im abgeschlossenen Einsatz gesperrt', async () => {
    rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
    await screen.findByText('Einsatz abgeschlossen');
    expect(await kopfaktion()).toBeDisabled();
  });

  it('ist gesperrt, solange der Stand lädt', async () => {
    rendere({ standStatus: 'haengt' });
    // Schreibrecht besteht (kein Rechte-Hinweis) — sonst wäre „gesperrt" aus dem falschen Grund richtig.
    await terminPaneel();
    expect(screen.queryByText('Nur Ansicht')).toBeNull();
    expect(await kopfaktion()).toBeDisabled();
  });

  /**
   * Ohne Stand fehlte der Termin zur Vorbelegung. Die Positivhälfte steht davor (Schreibrecht
   * besteht) und dahinter (der Stand kommt an → frei) — sonst wäre „gesperrt" aus dem falschen
   * Grund richtig.
   */
  it('ist bei dauerhaft gescheitertem Stand gesperrt, ohne eigenen Hinweis', async () => {
    rendere({ standStatus: 500 });
    expect(await screen.findByText(STAND_FEHLER)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Nur Ansicht')).toBeNull());
    expect(await kopfaktion()).toBeDisabled();

    server.use(http.get('/api/einsaetze/1/lagebesprechung', () => HttpResponse.json(leererStand)));
    await userEvent.click(screen.getByRole('button', { name: /Wiederholen|Erneut/ }));
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
    expect(await screen.findByText('Einsatz abgeschlossen')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    server.use(http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())));
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
    await waitFor(async () => expect(await kopfaktion()).toBeEnabled());
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  /**
   * Öffnen = Montieren, jede Öffnung hat eine frische Mutation. Die Maske wird beim Schließen
   * ausgehängt (nicht `open=false`) — deshalb darf auf das Verschwinden des Dialogs gewartet
   * werden.
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

describe('LagebesprechungPage · ?neu=1 (Schnellaktion)', () => {
  const ort = () => screen.getByRole('status', { name: 'Ort' });

  it('öffnet die Maske mit Schreibrecht und räumt den Parameter', async () => {
    rendere({ route: '/einsaetze/1/lagebesprechung?neu=1' });
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/lagebesprechung$/));
  });

  it('öffnet als Beobachter keine Maske, räumt den Parameter aber trotzdem', async () => {
    rendere({
      einsatzObj: einsatz({ meine_rolle: 'beobachter' }),
      route: '/einsaetze/1/lagebesprechung?neu=1',
    });
    // Positiv zuerst: der Leser ist gelaufen. Sonst wäre das `null` unten trivial.
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/lagebesprechung$/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('LagebesprechungPage · Vorbereitung der Lagebesprechung (LFH-550)', () => {
  const paneel = vorbereitungPaneel;
  const zeile = vorbereitungZeile;
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
    expect(zeile(p, 'betroffene')).toHaveTextContent('Quelle: Betroffene');
    expect(zeile(p, 'vermisste')).toHaveTextContent('1');
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    expect(zeile(p, 'auftraege')).toHaveTextContent('1 überfällig');
    expect(zeile(p, 'meldungen')).toHaveTextContent('3');
    expect(zeile(p, 'meldungen')).toHaveTextContent('Quelle: Meldungen (eingehend)');
  });

  it('„Letzte Lagebesprechung“ und „Nächster Termin“ kommen aus dem Modul Lagebesprechung', async () => {
    rendere({ stand: zweiStand, verlauf: ZWEI_VERLAUF });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'besprechung')).toHaveTextContent('Nr. 2'));
    expect(zeile(p, 'besprechung')).toHaveTextContent('Letzte Lagebesprechung');
    expect(zeile(p, 'besprechung')).toHaveTextContent(
      `abgehalten ${formatUhrzeitMitTag('2026-06-11 08:00:00', DEFAULT_KONVENTIONEN)}`,
    );
    expect(zeile(p, 'besprechung')).toHaveTextContent('Quelle: Lagebesprechung');
    expect(zeile(p, 'termin')).toHaveTextContent('Nächster Termin');
    expect(zeile(p, 'termin')).toHaveTextContent(
      formatUhrzeitMitTag('2026-06-11 09:00:00', DEFAULT_KONVENTIONEN),
    );
  });

  it('ohne Besprechung: „keine“ und „kein Termin“, nie „—“', async () => {
    rendere();
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'besprechung')).toHaveTextContent('keine'));
    expect(zeile(p, 'besprechung')).toHaveTextContent('noch keine abgehalten');
    expect(zeile(p, 'termin')).toHaveTextContent('kein Termin');
    expect(zeile(p, 'termin')).not.toHaveTextContent('—');
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

  /*
   * Modulgrenze (LFH-669, Spec `modul-freigabe`): die Vorbereitung fragt die Liste eines fremden
   * Moduls nur bei Freigabe des Servers an. Gesperrt ist kein Ausfall, sondern „—“ mit Grund.
   */
  const kurzWarten = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

  it('ein gesperrtes Modul wird nicht angefragt: „—“ mit Grund, keine 0, kein Ausfall', async () => {
    const abrufe: Record<string, number> = {};
    rendere({
      freigaben: freigabenFixture({
        personen: { zugriff: false },
        einheiten: { zugriff: false },
        lageberichte: { zugriff: false },
      }),
      lage: { abrufe, personen: [person(1)] },
    });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'betroffene')).toHaveTextContent('nicht freigegeben'));
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    await kurzWarten();
    // Vorbedingung: die freien Quellen liefen.
    expect(abrufe.personal).toBe(1);
    expect(abrufe.personen).toBeUndefined();
    expect(abrufe.einheiten).toBeUndefined();
    expect(abrufe.lageberichte).toBeUndefined();
    for (const s of ['betroffene', 'vermisste', 'sichtung', 'kraefte', 'lagebericht']) {
      expect(zeile(p, s), s).toHaveAttribute('data-zustand', 'gesperrt');
      expect(zeile(p, s), s).toHaveTextContent('—');
      expect(zeile(p, s), s).not.toHaveTextContent('nicht geladen');
    }
    expect(zeile(p, 'betroffene')).not.toHaveTextContent(/\b0\b/);
  });

  it('Kräfte hängen nur an Personal und Einheiten (LFH-887): gesperrte Fahrzeuge zeigen die Stärke', async () => {
    const abrufe: Record<string, number> = {};
    rendere({
      freigaben: freigabenFixture({
        fahrzeuge: { zugriff: false },
        material: { zugriff: false },
        einsatzabschnitte: { zugriff: false },
      }),
      lage: {
        abrufe,
        personal: [
          { id: 1, name: 'A', staerke_position: 'mannschaft', status_kategorie: 'verfuegbar' },
        ],
      },
    });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'kraefte')).toHaveAttribute('data-zustand', 'daten'));
    expect(zeile(p, 'kraefte')).toHaveTextContent('0/0/1//1');
    expect(zeile(p, 'kraefte')).not.toHaveTextContent('nicht freigegeben');
    expect(abrufe.fahrzeuge).toBeUndefined();
    expect(abrufe.material).toBeUndefined();
  });

  it('solange die Freigaben laden: keine modulgebundene Anfrage, die Zeilen „lädt“', async () => {
    const abrufe: Record<string, number> = {};
    rendere({ freigaben: 'haengt', lage: { abrufe } });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    await kurzWarten();
    expect(abrufe).toEqual({});
    expect(zeile(p, 'betroffene')).toHaveAttribute('data-zustand', 'laden');
    expect(zeile(p, 'kraefte')).toHaveAttribute('data-zustand', 'laden');
  });

  it('scheitert der Freigaben-Abruf: „nicht geladen“ statt ruhiger Lage, keine Anfrage', async () => {
    const abrufe: Record<string, number> = {};
    rendere({ freigaben: 'fehler', lage: { abrufe } });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'betroffene')).toHaveTextContent('nicht geladen'));
    await kurzWarten();
    expect(abrufe).toEqual({});
    for (const s of ['betroffene', 'kraefte', 'warnstufe', 'lagebericht']) {
      expect(zeile(p, s), s).toHaveAttribute('data-zustand', 'fehler');
      expect(zeile(p, s), s).toHaveTextContent('—');
    }
  });

  it('ein freies Modul, dessen Liste scheitert, bleibt ein Ausfall wie bisher', async () => {
    const abrufe: Record<string, number> = {};
    rendere({ lage: { abrufe, personenStatus: 500 } });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'betroffene')).toHaveTextContent('nicht geladen'));
    expect(zeile(p, 'betroffene')).toHaveAttribute('data-zustand', 'fehler');
    expect(abrufe.personen).toBe(1);
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
    const knopf = await within(p).findByRole('button', { name: /In Lagebericht übernehmen/ });
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
    expect(text.text).toContain('Quelle: Betroffene');
  });

  it('scheitert die Übernahme, steht der Fehler an der Seite, und es geht nicht weiter', async () => {
    rendere({});
    server.use(
      http.post('/api/einsaetze/1/lageberichte', () =>
        HttpResponse.json({ error: 'abgelehnt' }, { status: 422 }),
      ),
    );
    const p = await paneel();
    const knopf = await within(p).findByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    expect(await within(p).findByText('Nicht in den Lagebericht übernommen')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent(
      /^\/einsaetze\/1\/lagebesprechung$/,
    );
  });

  it('ohne Schreibrecht: Lagestand ja, Übernahme nein', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    expect(within(p).queryByRole('button', { name: /In Lagebericht übernehmen/ })).toBeNull();
  });

  it('ohne Freigabe der Lageberichte fehlt die Übernahme', async () => {
    rendere({ freigaben: freigabenFixture({ lageberichte: { sichtbar: false } }) });
    const p = await paneel();
    await waitFor(() => expect(zeile(p, 'auftraege')).toHaveTextContent('5'));
    expect(within(p).queryByRole('button', { name: /In Lagebericht übernehmen/ })).toBeNull();
  });
});
