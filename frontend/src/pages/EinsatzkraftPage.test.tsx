import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
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
const vorMinuten = (n: number) => dayjs.utc().subtract(n, 'minute').format('YYYY-MM-DD HH:mm:ss');

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
    disponiert_at: vorMinuten(40),
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
}

let anfragen: string[];
let bodies: unknown[];
/** Serverstand der beiden Listen; Entlassen und Reaktivieren verschieben die Person darin. */
let stand: { aktiv: EinsatzPersonal[]; entlassene: EinsatzPersonal[] };

function zeige(route = '/einsaetze/7/personal/10', a: Aufbau = {}) {
  anfragen = [];
  bodies = [];
  stand = { aktiv: a.aktiv ?? [kraft()], entlassene: a.entlassene ?? [] };
  const merke = async ({ request }: { request: Request }) => {
    anfragen.push(`${request.method} ${new URL(request.url).pathname}`);
    const text = await request.text();
    if (text) bodies.push(JSON.parse(text));
  };
  server.use(
    meHandler(a.benutzer ?? adminFixture()),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json(einsatzFixture({ id: 7, bezeichnung: 'Hochwasser', ...a.einsatz })),
    ),
    http.get('/api/einsaetze/7/modul-freigaben', () =>
      HttpResponse.json(a.freigaben ?? freigabenFixture()),
    ),
    http.get('/api/einsaetze/7/personal', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('entlassene') ? stand.entlassene : stand.aktiv,
      ),
    ),
    http.get('/api/einsaetze/7/personal/zeitachse', () => HttpResponse.json(a.perioden ?? [])),
    http.get('/api/einsaetze/7/einheiten', ({ request }) => {
      anfragen.push(`GET ${new URL(request.url).pathname}`);
      return HttpResponse.json(EINHEITEN);
    }),
    http.get('/api/einsaetze/7/fahrzeuge', ({ request }) => {
      anfragen.push(`GET ${new URL(request.url).pathname}`);
      return HttpResponse.json(FAHRZEUGE);
    }),
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/uhs', () =>
      HttpResponse.json([{ id: 21, bezeichnung: 'UHS Nord', status: 'aktiv' }]),
    ),
    http.get('/api/personal-status', () =>
      HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
        { id: 3, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, sortier: 30 },
      ]),
    ),
    http.get('/api/qualifikationen', () => HttpResponse.json([])),
    http.put('/api/einsaetze/7/einheiten/:eid/personal/:ep', async (info) => {
      await merke(info);
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch('/api/einsaetze/7/personal/:ep', async (info) => {
      await merke(info);
      return HttpResponse.json(kraft(bodies[bodies.length - 1] as Partial<EinsatzPersonal>));
    }),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personal/:epId" element={<EinsatzkraftPage />} />
      <Route path="/einsaetze/:id/personal" element={<Ort />} />
    </Routes>,
    { route },
  );
}

/** Ziel der Rückwege: zeigt die Adresse, auf der die Seite gelandet ist. */
function Ort() {
  const ort = useLocation();
  return <div data-testid="liste">{`${ort.pathname}${ort.search}`}</div>;
}

const ueberschriften = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());

describe('EinsatzkraftPage – Gerüst (3.1)', () => {
  it('folgt auf den Kopf mit Einteilung, Person, Zeitachse und zuletzt „Aus dem Einsatz“', async () => {
    zeige();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Lena Beispiel');
    expect(ueberschriften()).toEqual(['Einteilung', 'Person', 'Zeitachse', 'Aus dem Einsatz']);
  });

  it('nennt im Kopf Funktion, Träger und die laufende Einsatzdauer', async () => {
    zeige('/einsaetze/7/personal/10', {
      perioden: [
        {
          personal_id: 10,
          perioden: [{ beginn_at: vorMinuten(287), anker: 'alarmierung' }],
        },
      ],
    });
    // Die Meta steht in Teilen (sie bricht zwischen ihnen um); geprüft wird die ganze Folge an
    // der innersten Hülle, die sie trägt.
    const huellen = await screen.findAllByText(
      (_, el) =>
        el?.tagName === 'SPAN' && el.textContent === 'Sprechfunker · DRK · im Einsatz 4 h 47',
    );
    expect(huellen[huellen.length - 1]).toBeVisible();
  });

  it('zeigt ohne Ereignis keine Dauer und die Ruhe nach der letzten Periode', async () => {
    zeige('/einsaetze/7/personal/10', {
      perioden: [
        {
          personal_id: 10,
          perioden: [{ beginn_at: vorMinuten(300), ende_at: vorMinuten(70), anker: 'alarmierung' }],
        },
      ],
    });
    expect(await screen.findByText(/Ruhe 1 h 10/)).toBeVisible();
  });

  it('trägt die Marken „ad-hoc“ und „Demo“ im Kopf', async () => {
    zeige('/einsaetze/7/personal/10', {
      aktiv: [kraft({ ist_adhoc: true, personal_id: null })],
    });
    const kopf = await screen.findByRole('heading', { level: 1 });
    expect(within(kopf).getByText('ad-hoc')).toBeVisible();
  });

  it('führt mit der Brotkrume „Personal“ zur hervorgehobenen Zeile der Person', async () => {
    zeige();
    const link = await screen.findByRole('link', { name: 'Personal' });
    await userEvent.click(link);
    expect(await screen.findByTestId('liste')).toHaveTextContent(
      '/einsaetze/7/personal?personal=10',
    );
  });

  it('leitet eine ungültige ID zur Personalliste um', async () => {
    zeige('/einsaetze/7/personal/abc');
    expect(await screen.findByTestId('liste')).toHaveTextContent('/einsaetze/7/personal');
  });

  it('meldet eine unbekannte oder stornierte Person mit dem Weg zur Personalliste', async () => {
    zeige('/einsaetze/7/personal/99');
    expect(await screen.findByText('Nicht (mehr) im Einsatz')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Zur Personalliste' }));
    expect(await screen.findByTestId('liste')).toHaveTextContent('/einsaetze/7/personal');
  });

  it('abgeschlossener Einsatz: nur lesen, Grund genannt, keine Bearbeitung', async () => {
    zeige('/einsaetze/7/personal/10', { einsatz: { status: 'abgeschlossen' } });
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
    zeige();
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    await within(einteilung).findByText('Rettungsstaffel');
    expect(within(einteilung).getByText('Einheitsführer')).toBeVisible();
  });

  it('ändert die Einheit über die Zuordnung, Toast nennt die Angabe', async () => {
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bearbeiten' }));
    await waehle('Einheit', 'Zug 1');
    await userEvent.click(screen.getByRole('button', { name: 'Einheit speichern' }));
    await waitFor(() => expect(anfragen).toContain('PUT /api/einsaetze/7/einheiten/4/personal/10'));
    expect(await screen.findByText('Gespeichert: Einheit')).toBeInTheDocument();
  });

  it('kennzeichnet ein Fahrzeug einer anderen Einheit', async () => {
    zeige('/einsaetze/7/personal/10', { aktiv: [kraft({ fahrzeug_id: 9 })] });
    expect(await screen.findByText('andere Einheit')).toBeVisible();
  });

  it('schickt bei der Position nur die Position', async () => {
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Position bearbeiten' }));
    await waehle('Position', 'Führer');
    await userEvent.click(screen.getByRole('button', { name: 'Position speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ staerke_position: 'fuehrer' }]));
    expect(await screen.findByText('Gespeichert: Position')).toBeInTheDocument();
  });

  it('ohne Freigabe des Moduls Fahrzeuge: keine Zeile „Fahrzeug“ und kein Abruf', async () => {
    zeige('/einsaetze/7/personal/10', {
      freigaben: freigabenFixture({ fahrzeuge: { zugriff: false } }),
    });
    const einteilung = await screen.findByRole('region', { name: 'Einteilung' });
    await within(einteilung).findByText('Rettungsstaffel');
    expect(within(einteilung).queryByText('Fahrzeug')).toBeNull();
    expect(anfragen).not.toContain('GET /api/einsaetze/7/fahrzeuge');
    expect(within(einteilung).getByText('Unfallhilfsstelle')).toBeVisible();
  });

  it('springt ins Meldebild und in die Einheit', async () => {
    zeige();
    expect(await screen.findByRole('link', { name: /Meldebild/ })).toHaveAttribute(
      'href',
      '/einsaetze/7/kraefteuebersicht',
    );
    expect(await screen.findByRole('link', { name: /^Einheit/ })).toHaveAttribute(
      'href',
      '/einsaetze/7/einheiten/3',
    );
  });
});

describe('EinsatzkraftPage – Person (3.3)', () => {
  const adhoc = () => kraft({ ist_adhoc: true, personal_id: null, name: 'Maier' });

  it('berichtigt den Namen einer Ad-hoc-Person über den PATCH', async () => {
    zeige('/einsaetze/7/personal/10', { aktiv: [adhoc()] });
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Meier{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ name: 'Meier' }]));
  });

  it('sendet einen leeren Namen nicht und lässt den alten mit Hinweis stehen', async () => {
    zeige('/einsaetze/7/personal/10', { aktiv: [adhoc()] });
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Name speichern' }));
    expect(await screen.findByText(/Name ist eine Pflichtangabe/)).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('Stamm-Person für eine Führungskraft der Organisation: Text und Sprung in den Stamm', async () => {
    zeige('/einsaetze/7/personal/10', {
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
    zeige('/einsaetze/7/personal/10', { benutzer: benutzerFixture() });
    const person = await screen.findByRole('region', { name: 'Person' });
    await within(person).findByText('aus dem Stamm');
    expect(within(person).queryByRole('link', { name: /im Stamm ändern/ })).toBeNull();
  });
});

describe('EinsatzkraftPage – Aus dem Einsatz (3.4)', () => {
  it('entlässt ohne Rückfrage, bietet Rückgängig und zeigt die Person als entlassen', async () => {
    const entlassen = kraft({ beendet_at: vorMinuten(0), einheit_id: null, fahrzeug_id: null });
    zeige();
    server.use(
      http.post('/api/einsaetze/7/personal/10/entlassen', () => {
        stand = { aktiv: [], entlassene: [entlassen] };
        return HttpResponse.json(entlassen);
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Lena Beispiel entlassen' }));
    expect(await screen.findByRole('button', { name: 'Rückgängig' })).toBeInTheDocument();
    const kopf = screen.getByRole('heading', { level: 1 });
    await waitFor(() => expect(within(kopf).getByText('entlassen')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Erneut disponieren' })).toBeVisible();
  });

  it('storniert nach der Rückfrage und führt zur Personalliste', async () => {
    zeige('/einsaetze/7/personal/10', { aktiv: [kraft({ disponiert_at: vorMinuten(5) })] });
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
    zeige();
    const knopf = await screen.findByRole('button', { name: 'Stornieren' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('nur in den ersten 15 Minuten');
  });

  it('zeigt eine Ablehnung des Stornos im Abschnitt „Aus dem Einsatz“', async () => {
    zeige('/einsaetze/7/personal/10', { aktiv: [kraft({ disponiert_at: vorMinuten(5) })] });
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

describe('EinsatzkraftPage – entlassene Person (3.5)', () => {
  const entlassen = () =>
    kraft({ beendet_at: '2026-10-14T12:00:00Z', einheit_id: null, fahrzeug_id: null });

  it('liest nur, nennt die Entlassung und bietet „Erneut disponieren“', async () => {
    zeige('/einsaetze/7/personal/10', { aktiv: [], entlassene: [entlassen()] });
    const aus = await screen.findByRole('region', { name: 'Aus dem Einsatz' });
    // Zeitformat nach den Anzeigekonventionen des Einsatzes (Vorgabe ohne Doppelpunkt).
    expect(aus).toHaveTextContent(/entlassen 14:?00/);
    expect(within(aus).getByRole('button', { name: 'Erneut disponieren' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /bearbeiten$|eintragen$/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nachtragen' })).toBeDisabled();
  });

  it('macht die Angaben nach „Erneut disponieren“ wieder änderbar', async () => {
    zeige('/einsaetze/7/personal/10', { aktiv: [], entlassene: [entlassen()] });
    server.use(
      http.post('/api/einsaetze/7/personal/10/reaktivieren', () => {
        stand = { aktiv: [kraft({ einheit_id: null, fahrzeug_id: null })], entlassene: [] };
        return HttpResponse.json(stand.aktiv[0]);
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Erneut disponieren' }));
    expect(await screen.findByRole('button', { name: 'Position bearbeiten' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lena Beispiel entlassen' })).toBeVisible();
  });
});
