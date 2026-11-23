import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { Link, Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, renderMitProviders, setzeOnline } from '../test/utils';
import type { QueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { erwarteNichtGefunden, MarkenRahmen } from '../test/nichtGefunden';
import { waehle } from '../test/auswahlListe';
import { adminFixture, benutzerFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import type { EinsatzAnzeige, EinsatzPersonal } from '../api/types';
import EinsatzkraftPage from './EinsatzkraftPage';

/**
 * Personenansicht einer Einsatzkraft (LLH-1060, Spec `personal-ansicht`): Aufbau, Einteilung,
 * Person, Zeitachse, Entlassen und Stornieren, die entlassene Person und die Ränder (ungültige ID,
 * storniert, ohne Schreibrecht).
 */

dayjs.extend(utc);

/** Zeitpunkt vor `n` Minuten im kanonischen Format des Servers (UTC ohne Zone). */
const minutesAgo = (n: number) => dayjs.utc().subtract(n, 'minute').format('YYYY-MM-DD HH:mm:ss');

const EINHEITEN = [
  { id: 3, name: 'Rettungsstaffel', ueber_einheit_id: null, abschnitt_id: null, fuehrer_id: 10 },
  { id: 4, name: 'Zug 1', ueber_einheit_id: null, abschnitt_id: null, fuehrer_id: null },
];
const FAHRZEUGE = [
  { id: 8, funkrufname: 'Musterstadt 83-1', fahrzeugtyp: 'RTW', einheit_id: 3 },
  { id: 9, funkrufname: 'Florian 46-1', fahrzeugtyp: 'HLF', einheit_id: 4 },
];

function kraft(felder: Partial<EinsatzPersonal> = {}): EinsatzPersonal {
  return {
    id: 10,
    einsatz_id: 7,
    personal_id: 5,
    ist_adhoc: false,
    ist_demo: false,
    name: 'Lena Beispiel',
    funktion: 'Notfallsanitäterin',
    einsatzfunktion: 'Sprechfunker',
    traegerorganisation: 'DRK',
    staerke_position: 'unterfuehrer',
    status_id: 2,
    status_label: 'alarmiert',
    status_kategorie: 'gebunden',
    status_farbe: null,
    bemerkung: null,
    disponiert_at: minutesAgo(40),
    disponiert_von: 1,
    einheit_id: 3,
    fahrzeug_id: 8,
    uhs_id: null,
    ...felder,
  } as EinsatzPersonal;
}

interface Aufbau {
  aktiv?: EinsatzPersonal[];
  entlassene?: EinsatzPersonal[];
  einsatz?: Partial<EinsatzAnzeige>;
  freigaben?: ReturnType<typeof freigabenFixture>;
  benutzer?: ReturnType<typeof adminFixture>;
  perioden?: unknown[];
  /** Der Statuskatalog scheitert (500); `abgerufen` hält fest, dass er gefragt wurde. */
  statusFehler?: { abgerufen: boolean };
  /** Marke „nicht als letzten Ort merken“ des Einsatzrahmens (`test/nichtGefunden.tsx`). */
  marke?: { current: boolean };
  /** Links zu diesen Adressen neben der Seite (Text = Adresse): Wechsel der Detail-Route ohne
   * Remount. */
  sprung?: string[];
  /** Vorbefüllter Cache. */
  client?: QueryClient;
  /** Der Einsatz-Abruf scheitert (500). */
  einsatzFehler?: boolean;
}

let requests: string[];
let bodies: unknown[];
/** Serverstand der beiden Listen; Entlassen und Reaktivieren verschieben die Person darin. */
let serverState: { aktiv: EinsatzPersonal[]; entlassene: EinsatzPersonal[] };

function renderAnsicht(route = '/einsaetze/7/personal/10', a: Aufbau = {}) {
  requests = [];
  bodies = [];
  serverState = { aktiv: a.aktiv ?? [kraft()], entlassene: a.entlassene ?? [] };
  const rememberRequest = async ({ request }: { request: Request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    const text = await request.text();
    if (text) bodies.push(JSON.parse(text));
  };
  server.use(
    meHandler(a.benutzer ?? adminFixture()),
    http.get('/api/einsaetze/7', () =>
      a.einsatzFehler
        ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
        : HttpResponse.json(einsatzFixture({ id: 7, bezeichnung: 'Hochwasser', ...a.einsatz })),
    ),
    http.get('/api/einsaetze/7/module-access', () =>
      HttpResponse.json(a.freigaben ?? freigabenFixture()),
    ),
    http.get('/api/einsaetze/7/personal', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('entlassene')
          ? serverState.entlassene
          : serverState.aktiv,
      ),
    ),
    http.get('/api/einsaetze/7/personal/zeitachse', () => HttpResponse.json(a.perioden ?? [])),
    http.get('/api/einsaetze/7/einheiten', ({ request }) => {
      requests.push(`GET ${new URL(request.url).pathname}`);
      return HttpResponse.json(EINHEITEN);
    }),
    http.get('/api/einsaetze/7/fahrzeuge', ({ request }) => {
      requests.push(`GET ${new URL(request.url).pathname}`);
      return HttpResponse.json(FAHRZEUGE);
    }),
    http.get('/api/einsaetze/7/sectors', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/uhs', ({ request }) => {
      requests.push(`GET ${new URL(request.url).pathname}`);
      return HttpResponse.json([{ id: 21, bezeichnung: 'UHS Nord', status: 'aktiv' }]);
    }),
    http.put('/api/einsaetze/7/uhs/:uid/kraefte/:ep', async (info) => {
      await rememberRequest(info);
      return HttpResponse.json({ id: 10 });
    }),
    http.get('/api/personal-status', () => {
      if (a.statusFehler) {
        a.statusFehler.abgerufen = true;
        return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
      }
      return HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
        { id: 3, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, sortier: 30 },
      ]);
    }),
    http.get('/api/qualifikationen', () => HttpResponse.json([])),
    http.put('/api/einsaetze/7/einheiten/:eid/personal/:ep', async (info) => {
      await rememberRequest(info);
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch('/api/einsaetze/7/personal/:ep', async (info) => {
      await rememberRequest(info);
      return HttpResponse.json(kraft(bodies[bodies.length - 1] as Partial<EinsatzPersonal>));
    }),
  );
  return renderMitProviders(
    <MarkenRahmen marke={a.marke ?? { current: false }}>
      <Routes>
        <Route path="/einsaetze/:id/personal/:epId" element={<EinsatzkraftPage />} />
        <Route path="/einsaetze/:id/personal" element={<Ort />} />
      </Routes>
      {a.sprung?.map((ziel) => (
        <Link key={ziel} to={ziel}>
          {ziel}
        </Link>
      ))}
    </MarkenRahmen>,
    { route, client: a.client },
  );
}

/** Ziel der Rückwege: zeigt die Adresse, auf der die Seite gelandet ist. */
function Ort() {
  const ort = useLocation();
  return <div data-testid="liste">{`${ort.pathname}${ort.search}`}</div>;
}

const headings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());

describe('EinsatzkraftPage – Gerüst (3.1)', () => {
  it('folgt auf den Kopf mit Einteilung, Person, Zeitachse und zuletzt „Aus dem Einsatz“', async () => {
    renderAnsicht();
    await waitFor(() => expect(screen.queryByTestId('modul-gerippe')).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Lena Beispiel');
    expect(headings()).toEqual(['Einteilung', 'Person', 'Zeitachse', 'Aus dem Einsatz']);
  });

  it('nennt im Kopf Funktion, Träger und die laufende Einsatzdauer', async () => {
    renderAnsicht('/einsaetze/7/personal/10', {
      perioden: [
        {
          personal_id: 10,
          perioden: [{ beginn_at: minutesAgo(287), anker: 'alarmierung' }],
        },
      ],
    });
    // Die Meta steht in Teilen (sie bricht zwischen ihnen um); geprüft wird die ganze Folge an
    // der innersten Hülle, die sie trägt.
    const huellen = await screen.findAllByText(
      (_, el) =>
        el?.tagName === 'SPAN' && el.textContent === 'Sprechfunker · DRK · im Einsatz 4 h 47 min',
    );
    expect(huellen[huellen.length - 1]).toBeVisible();
  });

  it('zeigt ohne Ereignis keine Dauer und die Ruhe nach der letzten Periode', async () => {
    renderAnsicht('/einsaetze/7/personal/10', {
      perioden: [
        {
          personal_id: 10,
          perioden: [{ beginn_at: minutesAgo(300), ende_at: minutesAgo(70), anker: 'alarmierung' }],
        },
      ],
    });
    expect(await screen.findByText(/Ruhe 1 h 10 min/)).toBeVisible();
  });

  it('trägt die Marken „ad-hoc“ und „Demo“ im Kopf', async () => {
    renderAnsicht('/einsaetze/7/personal/10', {
      aktiv: [kraft({ ist_adhoc: true, personal_id: null })],
    });
    await waitFor(() => expect(screen.queryByTestId('modul-gerippe')).not.toBeInTheDocument());
    const kopf = await screen.findByRole('heading', { level: 1 });
    expect(within(kopf).getByText('ad-hoc')).toBeVisible();
  });

  it('führt mit der Brotkrume „Personal“ zur hervorgehobenen Zeile der Person', async () => {
    renderAnsicht();
    const link = await screen.findByRole('link', { name: 'Personal' });
    await userEvent.click(link);
    expect(await screen.findByTestId('liste')).toHaveTextContent(
      '/einsaetze/7/personal?personal=10',
    );
  });

  // Spec `seiten-zustaende`, „Ein Muster für ein Objekt, das es nicht gibt“ (LLH-1827, D4): keine
  // stille Weiterleitung, dasselbe Muster wie bei einer unbekannten Person.
  it('meldet eine ungültige ID wie eine unbekannte, statt still zur Personalliste umzuleiten', async () => {
    renderAnsicht('/einsaetze/7/personal/abc');
    await erwarteNichtGefunden({ titel: 'Nicht (mehr) im Einsatz', knopf: 'Zur Personalliste' });
    expect(screen.queryByTestId('liste')).toBeNull();
  });

  it('meldet eine unbekannte oder stornierte Person mit dem Weg zur Personalliste', async () => {
    renderAnsicht('/einsaetze/7/personal/99');
    expect(await screen.findByText('Nicht (mehr) im Einsatz')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Zur Personalliste' }));
    expect(await screen.findByTestId('liste')).toHaveTextContent('/einsaetze/7/personal');
  });

  it('eine unbekannte Person setzt die Marke: der Rahmen merkt die Adresse nicht als letzten Ort', async () => {
    const marke = { current: false };
    renderAnsicht('/einsaetze/7/personal/99', { marke });
    expect(await screen.findByText('Nicht (mehr) im Einsatz')).toBeVisible();
    expect(marke.current).toBe(true);
  });

  // LLH-1975: React Query setzt `error` auch, wenn nur ein Neuabruf scheitert und die Daten noch
  // im Zwischenspeicher liegen. Dann bleibt die Seite stehen, der Hinweis sagt es.
  it.each<[string, string, Pick<Aufbau, 'aktiv' | 'entlassene'>]>([
    ['aktiv', '', {}],
    ['aktiv', '/personal', {}],
    ['entlassen', '/personal', { aktiv: [], entlassene: [kraft()] }],
  ])(
    'gescheiterter Neuabruf (%s, /api/einsaetze/7%s): Seite bleibt, Hinweis zeigt den alten Stand',
    async (_lage, unterpfad, aufbau) => {
      const { client } = renderAnsicht('/einsaetze/7/personal/10', aufbau);
      await waitFor(() => expect(screen.queryByTestId('modul-gerippe')).not.toBeInTheDocument());
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Lena Beispiel');

      server.use(
        http.get(`/api/einsaetze/7${unterpfad}`, () =>
          HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
        ),
      );
      await act(() => client.refetchQueries());

      expect(
        await screen.findByText('Aktualisierung fehlgeschlagen · Stand womöglich veraltet'),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lena Beispiel');
      expect(screen.queryByText('Einsatz nicht gefunden oder kein Zugriff')).toBeNull();
      expect(screen.queryByText(/Personal konnte nicht geladen werden/)).toBeNull();
    },
  );

  it('gescheiterter Erstabruf des Einsatzes zeigt weiter die Fehlerseite', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { einsatzFehler: true });
    expect(await screen.findByText('Einsatz nicht gefunden oder kein Zugriff')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });

  it('eine vorhandene Person setzt die Marke nicht', async () => {
    const marke = { current: false };
    renderAnsicht('/einsaetze/7/personal/10', { marke });
    await waitFor(() => expect(screen.queryByTestId('modul-gerippe')).not.toBeInTheDocument());
    await screen.findByRole('heading', { level: 1 });
    expect(marke.current).toBe(false);
  });

  it('abgeschlossener Einsatz: nur lesen, Grund genannt, keine Bearbeitung', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { einsatz: { status: 'abgeschlossen' } });
    await waitFor(() => expect(screen.queryByTestId('modul-gerippe')).not.toBeInTheDocument());
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByText('Einsatz abgeschlossen').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /bearbeiten$|eintragen$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /entlassen$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stornieren' })).toBeNull();
    expect(await screen.findByText('Rettungsstaffel')).toBeVisible();
  });
});

describe('EinsatzkraftPage – Einteilung (3.2)', () => {
  it('nennt den Einheitsführer an der Einheit', async () => {
    renderAnsicht();
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    await within(einteilung).findByText('Rettungsstaffel');
    expect(within(einteilung).getByText('Einheitsführer')).toBeVisible();
  });

  it('ändert die Einheit über die Zuordnung, Toast nennt die Angabe', async () => {
    renderAnsicht();
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bearbeiten' }));
    await waehle('Einheit', 'Zug 1');
    await userEvent.click(screen.getByRole('button', { name: 'Einheit speichern' }));
    await waitFor(() => expect(requests).toContain('PUT /api/einsaetze/7/einheiten/4/personal/10'));
    expect(await screen.findByText('Gespeichert: Einheit')).toBeInTheDocument();
  });

  it('kennzeichnet ein Fahrzeug einer anderen Einheit', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [kraft({ fahrzeug_id: 9 })] });
    expect(await screen.findByText('andere Einheit')).toBeVisible();
  });

  it('schickt bei der Position nur die Position', async () => {
    renderAnsicht();
    await userEvent.click(await screen.findByRole('button', { name: 'Position bearbeiten' }));
    await waehle('Position', 'Führer');
    await userEvent.click(screen.getByRole('button', { name: 'Position speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { staerke_position: 'fuehrer', erwartet: { staerke_position: 'unterfuehrer' } },
      ]),
    );
    expect(await screen.findByText('Gespeichert: Position')).toBeInTheDocument();
  });

  it('ohne Freigabe des Moduls Fahrzeuge: keine Zeile „Fahrzeug“ und kein Abruf', async () => {
    renderAnsicht('/einsaetze/7/personal/10', {
      freigaben: freigabenFixture({ fahrzeuge: { zugriff: false } }),
    });
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    await within(einteilung).findByText('Rettungsstaffel');
    expect(within(einteilung).queryByText('Fahrzeug')).toBeNull();
    expect(requests).not.toContain('GET /api/einsaetze/7/fahrzeuge');
    expect(within(einteilung).getByText('Unfallhilfsstelle')).toBeVisible();
  });

  it('meldet einen gescheiterten Statuskatalog im Paneel „Einteilung“ mit Wiederholen', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { statusFehler: { abgerufen: false } });
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    expect(
      await within(einteilung).findByText(
        'Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich',
      ),
    ).toBeVisible();
    expect(within(einteilung).getByRole('button', { name: 'Erneut abrufen' })).toBeVisible();
  });

  it('ohne Schreibrecht meldet ein gescheiterter Statuskatalog nichts (der Status steht als Text)', async () => {
    const statusFehler = { abgerufen: false };
    renderAnsicht('/einsaetze/7/personal/10', {
      einsatz: { status: 'abgeschlossen' },
      statusFehler,
    });
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    await within(einteilung).findByText('Rettungsstaffel');
    // Vorbedingung: der Abruf ist wirklich gescheitert, sonst prüfte der Test nichts.
    await waitFor(() => expect(statusFehler.abgerufen).toBe(true));
    expect(within(einteilung).queryByText(/Statuskatalog konnte nicht geladen werden/)).toBeNull();
  });

  it('ohne Freigabe des Moduls Einheiten: keine Zeile „Einheit“ und kein Abruf', async () => {
    renderAnsicht('/einsaetze/7/personal/10', {
      freigaben: freigabenFixture({ einheiten: { zugriff: false } }),
    });
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    await within(einteilung).findByText('Musterstadt 83-1');
    expect(within(einteilung).queryByText('Einheit', { exact: true })).toBeNull();
    expect(within(einteilung).queryByRole('button', { name: 'Einheit bearbeiten' })).toBeNull();
    expect(requests).not.toContain('GET /api/einsaetze/7/einheiten');
    expect(within(einteilung).getByText('Unfallhilfsstelle')).toBeVisible();
  });

  it('ohne Freigabe des Moduls Unfallhilfsstellen: keine Zeile und kein Abruf', async () => {
    renderAnsicht('/einsaetze/7/personal/10', {
      freigaben: freigabenFixture({ unfallhilfsstellen: { zugriff: false } }),
    });
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    await within(einteilung).findByText('Rettungsstaffel');
    expect(within(einteilung).queryByText('Unfallhilfsstelle')).toBeNull();
    expect(requests).not.toContain('GET /api/einsaetze/7/uhs');
    // Gegenprobe: die übrigen Zeilen stehen.
    expect(within(einteilung).getByText('Fahrzeug')).toBeVisible();
  });

  it('ordnet die Person einer Unfallhilfsstelle zu, Toast nennt die Angabe', async () => {
    renderAnsicht();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Unfallhilfsstelle eintragen' }),
    );
    await waehle('Unfallhilfsstelle', 'UHS Nord');
    await userEvent.click(screen.getByRole('button', { name: 'Unfallhilfsstelle speichern' }));
    await waitFor(() => expect(requests).toContain('PUT /api/einsaetze/7/uhs/21/kraefte/10'));
    expect(await screen.findByText('Gespeichert: Unfallhilfsstelle')).toBeInTheDocument();
  });

  it('springt ins Meldebild und in die Einheit', async () => {
    renderAnsicht();
    expect(await screen.findByRole('link', { name: /Kräfteübersicht/ })).toHaveAttribute(
      'href',
      '/einsaetze/7/kraefteuebersicht',
    );
    expect(await screen.findByRole('link', { name: /^Einheit/ })).toHaveAttribute(
      'href',
      '/einsaetze/7/einheiten/3',
    );
  });
});

describe('EinsatzkraftPage – zwischenzeitlich geändert (LLH-1945)', () => {
  /** PATCH mit Altwert: 409, solange `erwartet` nicht zum Serverstand passt. */
  function mitFeldCas() {
    server.use(
      http.patch('/api/einsaetze/7/personal/:ep', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        const erwartet = body.erwartet as Record<string, unknown> | undefined;
        const stand = serverState.aktiv[0] as unknown as Record<string, unknown>;
        if (erwartet && Object.entries(erwartet).some(([k, v]) => (stand[k] ?? null) !== v)) {
          return HttpResponse.json({ error: 'veraltet', grund: 'veraltet' }, { status: 409 });
        }
        const felder = { ...body };
        delete felder.erwartet;
        serverState.aktiv = [{ ...serverState.aktiv[0], ...felder }];
        return HttpResponse.json(serverState.aktiv[0]);
      }),
    );
  }

  it('Bemerkung: Rückfrage mit dem aktuellen Wert, „Meine Änderung übernehmen“ ohne Altwert und mit Toast', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [kraft({ bemerkung: 'Tor 3' })] });
    mitFeldCas();
    await userEvent.click(await screen.findByRole('button', { name: 'Bemerkung bearbeiten' }));
    serverState.aktiv = [kraft({ bemerkung: 'Tor 5' })];
    const feld = screen.getByRole('textbox', { name: 'Bemerkung' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Halle 2');
    await userEvent.click(screen.getByRole('button', { name: 'Bemerkung speichern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    expect(dialog).toHaveTextContent('Bemerkung inzwischen: „Tor 5“');
    expect(bodies).toEqual([{ bemerkung: 'Halle 2', erwartet: { bemerkung: 'Tor 3' } }]);
    expect(screen.queryByText('Gespeichert: Bemerkung')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Meine Änderung übernehmen' }));
    expect(await screen.findByText('Gespeichert: Bemerkung')).toBeInTheDocument();
    expect(bodies[1]).toEqual({ bemerkung: 'Halle 2' });
  });

  it('Einsatzfunktion: „Verwerfen und neu laden“ schreibt nichts und meldet nichts als gespeichert', async () => {
    renderAnsicht();
    mitFeldCas();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Funktion zu Lena Beispiel bearbeiten' }),
    );
    serverState.aktiv = [kraft({ einsatzfunktion: 'Melder' })];
    const feld = screen.getByRole('combobox', { name: 'Funktion zu Lena Beispiel' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Gruppenführer');
    await userEvent.click(
      screen.getByRole('button', { name: 'Funktion zu Lena Beispiel speichern' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    expect(dialog).toHaveTextContent('Einsatzfunktion inzwischen: „Melder“');
    expect(bodies).toEqual([
      { einsatzfunktion: 'Gruppenführer', erwartet: { einsatzfunktion: 'Sprechfunker' } },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen und neu laden' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Funktion zu Lena Beispiel bearbeiten' }),
      ).toHaveTextContent('Melder'),
    );
    expect(bodies).toHaveLength(1);
    expect(screen.queryByText('Gespeichert: Einsatzfunktion')).toBeNull();
  });
});

describe('EinsatzkraftPage – Person (3.3)', () => {
  const adhoc = () => kraft({ ist_adhoc: true, personal_id: null, name: 'Maier' });

  it('berichtigt den Namen einer Ad-hoc-Person über den PATCH', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [adhoc()] });
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Meier{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ name: 'Meier', erwartet: { name: 'Maier' } }]));
  });

  it('sendet einen leeren Namen nicht und lässt den alten mit Hinweis stehen', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [adhoc()] });
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Name speichern' }));
    expect(await screen.findByText(/Name ist eine Pflichtangabe/)).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('Stamm-Person für eine Führungskraft der Organisation: Text und Sprung in den Stamm', async () => {
    renderAnsicht('/einsaetze/7/personal/10', {
      benutzer: benutzerFixture({ org_rolle: 'fuehrungskraft' }),
    });
    const person = await screen.findByRole('region', { name: 'Person' });
    expect(within(person).getByText('aus dem Stamm')).toBeVisible();
    expect(within(person).queryByRole('button', { name: 'Name bearbeiten' })).toBeNull();
    expect(within(person).getByRole('link', { name: /im Stamm ändern/ })).toHaveAttribute(
      'href',
      '/admin/stammdaten/personal/5',
    );
  });

  it('Stamm-Person ohne Zugang zur Verwaltung: kein Sprung', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { benutzer: benutzerFixture() });
    const person = await screen.findByRole('region', { name: 'Person' });
    await within(person).findByText('aus dem Stamm');
    expect(within(person).queryByRole('link', { name: /im Stamm ändern/ })).toBeNull();
  });
});

describe('EinsatzkraftPage – Aus dem Einsatz (3.4)', () => {
  /** Vorzustand der Antwort von `…/entlassen` (LLH-1922). */
  const VORZUSTAND = {
    entlassen_at: '2026-11-17 11:00:00',
    einheit_id: 3,
    fahrzeug_id: 5,
    uhs_id: null,
    gefuehrte_einheiten: [3],
    geleitete_abschnitte: [],
    einsatzleiter_name: null,
  };
  /** Entlassen antwortet mit Person und Vorzustand; die Person wandert in die Entlassenen. */
  function entlassenAntwortet() {
    const entlassen = kraft({ beendet_at: minutesAgo(0), einheit_id: null, fahrzeug_id: null });
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen', () => {
        serverState = { aktiv: [], entlassene: [entlassen] };
        return HttpResponse.json({ personal: entlassen, vorzustand: VORZUSTAND });
      }),
    );
  }

  it('entlässt ohne Rückfrage, bietet Rückgängig und zeigt die Person als entlassen', async () => {
    renderAnsicht();
    entlassenAntwortet();
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    expect(await screen.findByRole('button', { name: 'Rückgängig' })).toBeInTheDocument();
    const kopf = screen.getByRole('heading', { level: 1 });
    await waitFor(() => expect(within(kopf).getByText('entlassen')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Erneut disponieren' })).toBeVisible();
  });

  it('Rückgängig nimmt mit dem Vorzustand zurück statt neu zu disponieren', async () => {
    renderAnsicht();
    entlassenAntwortet();
    let reaktiviert = false;
    server.use(
      http.post('/api/einsaetze/7/personal/10/reaktivieren', () => {
        reaktiviert = true;
        return HttpResponse.json(kraft());
      }),
      http.post('/api/einsaetze/7/personal/10/entlassen/zuruecknehmen', async ({ request }) => {
        requests.push(`POST ${new URL(request.url).pathname}`);
        bodies.push(await request.json());
        serverState = { aktiv: [kraft()], entlassene: [] };
        return HttpResponse.json({ personal: kraft(), ausgelassen: [] });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() =>
      expect(requests).toContain('POST /api/einsaetze/7/personal/10/entlassen/zuruecknehmen'),
    );
    expect(bodies).toContainEqual(VORZUSTAND);
    const kopf = screen.getByRole('heading', { level: 1 });
    await waitFor(() => expect(within(kopf).queryByText('entlassen')).toBeNull());
    expect(reaktiviert).toBe(false);
    expect(screen.queryByText(/zurück, ohne/)).toBeNull();
  });

  it('nennt im Seitenhinweis, was die Rücknahme ausgelassen hat', async () => {
    renderAnsicht();
    entlassenAntwortet();
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen/zuruecknehmen', () => {
        serverState = { aktiv: [kraft()], entlassene: [] };
        return HttpResponse.json({
          personal: kraft(),
          ausgelassen: [{ bezeichnung: 'Führung von «Zug 1»', grund: 'inzwischen anders besetzt' }],
        });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    expect(
      await screen.findByText(
        'Lena Beispiel zurück, ohne: Führung von «Zug 1» (inzwischen anders besetzt)',
      ),
    ).toBeVisible();
  });

  it('Rückgängig nach einem Wechsel zu einer anderen Person nimmt die entlassene zurück', async () => {
    const zweite = kraft({ id: 11, name: 'Ben Zweit' });
    renderAnsicht('/einsaetze/7/personal/10', {
      aktiv: [kraft(), zweite],
      sprung: ['/einsaetze/7/personal/11'],
    });
    const entlassen = kraft({ beendet_at: minutesAgo(0), einheit_id: null, fahrzeug_id: null });
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen', () => {
        serverState = { aktiv: [zweite], entlassene: [entlassen] };
        return HttpResponse.json({ personal: entlassen, vorzustand: VORZUSTAND });
      }),
      http.post('/api/einsaetze/7/personal/:ep/entlassen/zuruecknehmen', ({ request }) => {
        requests.push(`POST ${new URL(request.url).pathname}`);
        return HttpResponse.json(
          { error: 'Die Entlassung lässt sich nicht mehr zurücknehmen' },
          { status: 409 },
        );
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    const rueckgaengig = await screen.findByRole('button', { name: 'Rückgängig' });
    await userEvent.click(screen.getByRole('link', { name: '/einsaetze/7/personal/11' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Ben Zweit');
    await userEvent.click(rueckgaengig);
    await waitFor(() =>
      expect(requests).toContain('POST /api/einsaetze/7/personal/10/entlassen/zuruecknehmen'),
    );
    // Die Ablehnung gehört zu Lena Beispiel und steht nicht über Ben Zweit.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Nicht zurückgenommen')).toBeNull();
  });

  it('räumt den Hinweis der gescheiterten Rücknahme beim Wechsel zu einer anderen Person', async () => {
    const zweite = kraft({ id: 11, name: 'Ben Zweit' });
    renderAnsicht('/einsaetze/7/personal/10', {
      aktiv: [kraft(), zweite],
      sprung: ['/einsaetze/7/personal/11', '/einsaetze/7/personal/10'],
    });
    const entlassen = kraft({ beendet_at: minutesAgo(0), einheit_id: null, fahrzeug_id: null });
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen', () => {
        serverState = { aktiv: [zweite], entlassene: [entlassen] };
        return HttpResponse.json({ personal: entlassen, vorzustand: VORZUSTAND });
      }),
      http.post('/api/einsaetze/7/personal/10/entlassen/zuruecknehmen', () =>
        HttpResponse.json({ error: 'Zeitachse berichtigt' }, { status: 409 }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByText('Nicht zurückgenommen')).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: '/einsaetze/7/personal/11' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Ben Zweit');
    await userEvent.click(screen.getByRole('link', { name: '/einsaetze/7/personal/10' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Lena Beispiel');
    expect(screen.queryByText('Nicht zurückgenommen')).toBeNull();
  });

  it('räumt den Hinweis der gescheiterten Rücknahme beim erneuten Disponieren', async () => {
    renderAnsicht();
    entlassenAntwortet();
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen/zuruecknehmen', () =>
        HttpResponse.json({ error: 'Zeitachse berichtigt' }, { status: 409 }),
      ),
      http.post('/api/einsaetze/7/personal/10/reaktivieren', () => {
        serverState = { aktiv: [kraft()], entlassene: [] };
        return HttpResponse.json(kraft());
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByText('Nicht zurückgenommen')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut disponieren' }));
    await waitFor(() => expect(screen.queryByText('Nicht zurückgenommen')).toBeNull());
  });

  it('zeigt eine Ablehnung der Rücknahme im Seitenhinweis, die Person bleibt entlassen', async () => {
    renderAnsicht();
    entlassenAntwortet();
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen/zuruecknehmen', () =>
        HttpResponse.json(
          {
            error:
              'Die Zeitachse der Person ist seit dem Entlassen berichtigt; die Person lässt sich erneut disponieren',
          },
          { status: 409 },
        ),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByText(/Zeitachse der Person ist seit dem Entlassen/)).toBeVisible();
    expect(screen.getByText('Nicht zurückgenommen')).toBeVisible();
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('entlassen')).toBeVisible();
  });

  it('zeigt eine Ablehnung des Entlassens im Abschnitt „Aus dem Einsatz“, die Person bleibt', async () => {
    renderAnsicht();
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen', () =>
        HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 422 }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    const aus = screen.getByRole('region', { name: 'Aus dem Einsatz' });
    expect(await within(aus).findByText(/Einsatz ist abgeschlossen/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
    expect(within(screen.getByRole('heading', { level: 1 })).queryByText('entlassen')).toBeNull();
  });

  it('storniert nach der Rückfrage und führt zur Personalliste', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [kraft({ disponiert_at: minutesAgo(5) })] });
    let storniert = false;
    server.use(
      http.post('/api/einsaetze/7/personal/10/stornieren', () => {
        storniert = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Stornieren' }));
    const rueckfrage = await screen.findByRole('tooltip');
    expect(within(rueckfrage).getByText('Lena Beispiel stornieren?')).toBeInTheDocument();
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Stornieren' }));
    expect(await screen.findByTestId('liste')).toHaveTextContent('/einsaetze/7/personal');
    expect(storniert).toBe(true);
  });

  it('sperrt „Stornieren“ nach 15 Minuten mit Kurzgrund', async () => {
    renderAnsicht();
    const knopf = await screen.findByRole('button', { name: 'Stornieren' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('nur in den ersten 15 Minuten');
  });

  it('zeigt eine Ablehnung des Stornos im Abschnitt „Aus dem Einsatz“', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [kraft({ disponiert_at: minutesAgo(5) })] });
    server.use(
      http.post('/api/einsaetze/7/personal/10/stornieren', () =>
        HttpResponse.json({ error: 'Kraft ist schon eingetroffen' }, { status: 422 }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Stornieren' }));
    const rueckfrage = await screen.findByRole('tooltip');
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Stornieren' }));
    const aus = screen.getByRole('region', { name: 'Aus dem Einsatz' });
    expect(await within(aus).findByText(/schon eingetroffen/)).toBeVisible();
  });
});

/**
 * Review a12ms7g9 (F8): Ob es die Kraft nicht (mehr) gibt, steht erst fest, wenn beide Listen
 * stehen. Scheitert eine oder wartet sie ohne Netz ohne Stand, ist das ein Abruffehler mit
 * „Erneut abrufen“, nicht das Muster „gibt es nicht“.
 */
describe('EinsatzkraftPage – Abruffehler statt „gibt es nicht“', () => {
  it('eine gescheiterte Liste der Entlassenen zeigt den Abruffehler, nicht „Nicht (mehr) im Einsatz“', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [] });
    server.use(
      http.get('/api/einsaetze/7/personal', ({ request }) =>
        new URL(request.url).searchParams.has('entlassene')
          ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
          : HttpResponse.json([]),
      ),
    );
    expect(
      await screen.findByText('Entlassenes Personal konnte nicht geladen werden'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /Erneut abrufen/ })).toBeVisible();
    expect(screen.queryByText('Nicht (mehr) im Einsatz')).toBeNull();
  });

  it('ohne Netz und ohne Stand der Listen zeigt es den Abruffehler, nicht „Nicht (mehr) im Einsatz“', async () => {
    const client = neuerQueryClient();
    client.setQueryDefaults(einsatzKeys.einsatz(7), { staleTime: Infinity });
    client.setQueryData(
      einsatzKeys.einsatz(7),
      einsatzFixture({ id: 7, bezeichnung: 'Hochwasser' }),
    );
    setzeOnline(false);
    try {
      renderAnsicht('/einsaetze/7/personal/10', { client });
      expect(
        await screen.findByText('Disponiertes Personal konnte nicht geladen werden'),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: /Erneut abrufen/ })).toBeVisible();
      expect(screen.queryByText('Nicht (mehr) im Einsatz')).toBeNull();
    } finally {
      setzeOnline(true);
    }
  });
});

describe('EinsatzkraftPage – entlassene Person (3.5)', () => {
  // Heute 14:00 Ortszeit: an einem früheren Tag stellt die Anzeige den Tag voran.
  const heute1400 = () => dayjs().hour(14).minute(0).second(0).utc().format('YYYY-MM-DD HH:mm:ss');
  const entlassen = () => kraft({ beendet_at: heute1400(), einheit_id: null, fahrzeug_id: null });

  it('liest nur, nennt die Entlassung und bietet „Erneut disponieren“', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [], entlassene: [entlassen()] });
    const aus = await screen.findByRole('region', { name: 'Aus dem Einsatz' });
    // Zeitformat nach den Anzeigekonventionen des Einsatzes (Vorgabe ohne Doppelpunkt).
    expect(aus).toHaveTextContent(/entlassen 14:?00/);
    expect(within(aus).getByRole('button', { name: 'Erneut disponieren' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /bearbeiten$|eintragen$/ })).toBeNull();
  });

  it('lässt die Zeitachse berichtigen, alles andere bleibt gesperrt (LLH-1263)', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [], entlassene: [entlassen()] });
    const zeitachse = await screen.findByRole('region', { name: 'Zeitachse' });
    expect(within(zeitachse).getByRole('button', { name: 'Nachtragen' })).toBeEnabled();
    expect(within(zeitachse).queryByText('entlassen')).toBeNull();
    expect(screen.queryByRole('button', { name: /bearbeiten$|eintragen$/ })).toBeNull();
  });

  it('macht die Angaben nach „Erneut disponieren“ wieder änderbar', async () => {
    renderAnsicht('/einsaetze/7/personal/10', { aktiv: [], entlassene: [entlassen()] });
    server.use(
      http.post('/api/einsaetze/7/personal/10/reaktivieren', () => {
        serverState = { aktiv: [kraft({ einheit_id: null, fahrzeug_id: null })], entlassene: [] };
        return HttpResponse.json(serverState.aktiv[0]);
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Erneut disponieren' }));
    expect(await screen.findByRole('button', { name: 'Position bearbeiten' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lena Beispiel entlassen' })).toBeVisible();
  });
});
