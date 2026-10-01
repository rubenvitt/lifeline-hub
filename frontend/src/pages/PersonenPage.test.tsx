import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { setzeViewportBreite } from '../test/viewport';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzAnzeige, Person } from '../api/types';
import PersonenPage from './PersonenPage';
import PersonenDetailPage from './PersonenDetailPage';
import {
  personErfassungsQuittungenLaden,
  queueLeerenFuerTests,
  queueZaehlerLaden,
  schreibaktionPersonAbschliessen,
  schreibaktionEinreihen,
  schreibaktionenLaden,
} from '../offline/queue';
import {
  meldeOfflineSchreibaktionGesendet,
  offlineQuittungsKanalZuruecksetzenFuerTests,
  OFFLINE_SCHREIBAKTION_GESENDET_EVENT,
} from '../offline/ereignisse';
import { useOfflineSync } from '../offline/useOfflineSync';
import type { KartenflaecheProps } from './lagekarte/Kartenflaeche';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import * as dateiSpeichern from '../components/dateiSpeichern';

/**
 * Die echte Karte braucht WebGL, jsdom hat keins — Stub nach dem Muster von
 * `LagekartePage.test.tsx`. Er zeigt, was die Kartenansicht an die Karte übergibt (Marker samt
 * Beschriftung, Startausschnitt), und bietet je Marker einen Knopf, der den Klick wie die echte
 * Karte meldet. Ob die Marker gezeichnet werden, belegt `e2e/betroffene-karte.spec.ts`.
 */
vi.mock('./lagekarte/Kartenflaeche', () => ({
  default: (props: Partial<KartenflaecheProps>) => (
    <div data-testid="kartenflaeche-stub">
      <div data-testid="startansicht">{JSON.stringify(props.startAnsicht ?? null)}</div>
      {(props.markers ?? []).map((m) => (
        <button key={m.schluessel} onClick={() => props.onMarkerKlick?.(m.schluessel)}>
          marker-{m.schluessel}: {m.label}
        </button>
      ))}
    </div>
  ),
}));

class FakeBroadcastChannel {
  static instanzen: FakeBroadcastChannel[] = [];
  readonly postMessage = vi.fn();
  readonly name: string;
  private readonly listener = new Set<(event: MessageEvent<unknown>) => void>();

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instanzen.push(this);
  }

  addEventListener(_typ: string, listener: (event: MessageEvent<unknown>) => void) {
    this.listener.add(listener);
  }

  removeEventListener(_typ: string, listener: (event: MessageEvent<unknown>) => void) {
    this.listener.delete(listener);
  }

  sendeAusAnderemTab(daten: unknown) {
    for (const listener of this.listener) listener({ data: daten } as MessageEvent<unknown>);
  }

  close() {
    this.listener.clear();
  }
}

beforeEach(async () => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  FakeBroadcastChannel.instanzen = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  setzeOnline(true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  // Die Seite lädt die Unfallhilfsstellen für `@UHS` und die Verbleib-Spalte; ohne eigene Angabe
  // gibt es keine.
  server.use(http.get('/api/einsaetze/:einsatzId/uhs', () => HttpResponse.json([])));
  await queueLeerenFuerTests();
});
afterEach(() => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.unstubAllGlobals();
});

// Normaler Benutzer (kein System-Admin): geprüft wird die Einsatz-Rolle; admin-global deckt
// schreibrecht.test.ts ab.
const nutzer = benutzerFixture();
const einsatzAktiv = einsatzFixture();
const einsatzBeobachter = einsatzFixture({ meine_rolle: 'beobachter' });

const person: Person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
};
const unbekannt = {
  ...person,
  id: 11,
  registrier_nr: 2,
  name: null,
  vorname: null,
  status: 'vermisst',
};

/**
 * Zeilenfolge der Registriernummern in Dokumentordnung. Die Folge statt eines gerenderten
 * Zeitstrings: ohne `EinsatzAnzeigeProvider` fällt `useAnzeigeKonventionen` auf Lokalzeit zurück,
 * eine Zeitbehauptung prüfte die Zeitzone des Testrechners.
 *
 * `getAllByText` vergleicht nur direkte Textkinder, die verschachtelte Titelzelle
 * (`<a><span><strong>R-001</strong></span></a>`) liefert also einen Treffer je Zeile.
 */
function regFolge(): string[] {
  return screen.getAllByText(/^R-\d{3}$/).map((e) => e.textContent ?? '');
}

function quittungSchliessenButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.ant-alert-close-icon');
}

function render(
  einsatzObj: typeof einsatzAktiv,
  personen: unknown[],
  route = '/einsaetze/1/personen',
) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
      <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
    </Routes>,
    { route },
  );
}

function EinsatzNavigation() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/einsaetze/1/personen')}>Zu Einsatz A</button>
      <button onClick={() => navigate('/einsaetze/2/personen')}>Zu Einsatz B</button>
    </>
  );
}

function renderMitEinsatzNavigation(route = '/einsaetze/1/personen') {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/personen"
        element={
          <>
            <EinsatzNavigation />
            <PersonenPage />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

function OfflineSyncTest({ benutzerId }: { benutzerId: number }) {
  useOfflineSync(benutzerId);
  return null;
}

describe('PersonenPage', () => {
  it('zeigt in der Vorgabe ALLE Personen; der Filter „Neu" zeigt nur erfasste', async () => {
    // Vorgabe „Alle": eine mit Sichtung erfasste Person hebt der Server auf `betroffen` — unter
    // „Neu" verschwände sie beim Erfassen.
    render(einsatzAktiv, [person, unbekannt]);
    expect(await screen.findByText('R-001')).toBeInTheDocument();
    expect(screen.getByText('R-002')).toBeInTheDocument();
    expect(screen.getByText('Mustermann, Max')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Neu' }));
    await vi.waitFor(() => expect(screen.queryByText('R-002')).not.toBeInTheDocument());
    expect(screen.getByText('R-001')).toBeInTheDocument();
  });

  it('filtert per Tab auf Vermisst und zeigt „unbekannt"', async () => {
    render(einsatzAktiv, [person, unbekannt]);
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('R-002')).toBeInTheDocument();
    expect(screen.getByText('unbekannt')).toBeInTheDocument();
  });

  it('nimmt den Suchbegriff nicht in den nächsten Reiter mit', async () => {
    /**
     * Eine `Datensicht` bedient fünf Reiter. Bei konstantem `key` reichte React beim Reiterwechsel
     * dieselbe Instanz weiter, und `suchbegriff` lebt in der Sicht: der Begriff aus „Vermisst"
     * filterte danach die Menge von „Betroffen".
     *
     * Drei Schritte: Schritt 1 zeigt, dass der Begriff wirkt (sonst bliebe „das Feld ist leer" auch
     * ohne filternde Suche grün); Schritt 3 prüft die fremde Menge.
     */
    const mueller = {
      ...person,
      id: 60,
      registrier_nr: 11,
      status: 'vermisst' as const,
      name: 'Müller',
      vorname: 'Anna',
    };
    const krause = {
      ...person,
      id: 61,
      registrier_nr: 12,
      status: 'vermisst' as const,
      name: 'Krause',
      vorname: 'Bernd',
    };
    const schmidt = {
      ...person,
      id: 62,
      registrier_nr: 13,
      status: 'betroffen' as const,
      name: 'Schmidt',
      vorname: 'Carla',
    };
    render(einsatzAktiv, [mueller, krause, schmidt]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('Krause, Bernd')).toBeInTheDocument();

    // 1. Die Suche wirkt überhaupt: die nicht passende Zeile fällt heraus.
    await userEvent.type(screen.getByRole('searchbox', { name: 'Suche in Personen' }), 'Müller');
    await vi.waitFor(() => expect(screen.queryByText('Krause, Bernd')).not.toBeInTheDocument());
    expect(screen.getByText('Müller, Anna')).toBeInTheDocument();

    // 2. + 3. Reiterwechsel: die fremde Menge steht ungefiltert da, das Feld ist leer.
    await userEvent.click(screen.getByRole('tab', { name: 'Betroffen' }));
    expect(await screen.findByText('Schmidt, Carla')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Suche in Personen' })).toHaveValue('');
  });

  /**
   * Der Seitenkopf kommt aus `EinsatzSeite`, nicht aus einem handgebauten Block. Die zweite Zeile
   * ist die tragende: „level 1 da" allein wäre auch mit Handbau daneben grün.
   */
  it('trägt den Seitenkopf „Betroffene" mit Mono-Meta „n erfasst"', async () => {
    render(einsatzAktiv, [person, unbekannt]);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Betroffene' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('2 erfasst')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Einsätze' })).toBeInTheDocument();
  });

  it('Einsatzleitung sieht die Erfassungszeile und die Masken-Wege', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: /Betroffene/ });
    expect(screen.getByRole('textbox', { name: 'Kurzeingabe Person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Person erfassen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Betroffene/n erfassen' })).toBeInTheDocument();
  });

  it('bestätigt die Registriernummer, macht die neue Person sichtbar und hebt sie hervor', async () => {
    const vermisst = {
      ...person,
      id: 47,
      registrier_nr: 47,
      status: 'vermisst' as const,
      name: 'Neu',
    };
    server.use(
      http.post('/api/einsaetze/1/personen', async ({ request }) => {
        const body = (await request.json()) as { status?: string; client_id?: string };
        expect(body.status).toBe('vermisst');
        expect(body.client_id).toBeTruthy();
        return HttpResponse.json(vermisst, { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    // Ein Filter, der die neue Person verbirgt: er muss auf „Alle" zurückfallen, sonst stünde die
    // Hervorhebung an einer unsichtbaren Zeile.
    await userEvent.click(await screen.findByRole('tab', { name: 'Neu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    // Der Name liegt unter „Weitere Angaben" — hier genügt der Antreffort, die Maske hat keine
    // Pflichtfelder.
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Brücke');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('Erfasst als R-047')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    const kennung = await screen.findByText('R-047');
    expect(kennung.closest('tr')).toHaveClass('zeile-hervorgehoben');
  });

  /**
   * Die Quittung nennt die Sichtung aus der Antwort, nicht aus den gesendeten Werten: das Backend
   * kann sie mit 422 verwerfen, aus dem Formularwert gelesen behauptete die Quittung dann eine
   * Kategorie, die es nie gab.
   */
  it('nennt die vergebene Sichtung in der Quittung', async () => {
    const gesichtet = {
      ...person,
      id: 48,
      registrier_nr: 48,
      status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const,
    };
    let gesendet: { sichtung?: string } = {};
    server.use(
      http.post('/api/einsaetze/1/personen', async ({ request }) => {
        gesendet = (await request.json()) as { sichtung?: string };
        return HttpResponse.json(gesichtet, { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const skZwei = within(
      screen.getByRole('radiogroup', { name: 'Sichtungskategorie' }),
    ).getAllByRole('radio')[1];
    await userEvent.click(skZwei.closest('label')!);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('Erfasst als R-048 · SK II')).toBeInTheDocument();
    expect(gesendet.sichtung).toBe('sk2');
  });

  it('lässt die Quittung ohne Sichtung bei der reinen Registriernummer', async () => {
    // Die Gegenhälfte: ohne sie wäre der Fall oben auch grün, wenn dort immer ein Zusatz stünde —
    // etwa ein „undefined" aus einem fehlenden Nachschlag.
    server.use(
      http.post('/api/einsaetze/1/personen', () =>
        HttpResponse.json({ ...person, id: 49, registrier_nr: 49 }, { status: 201 }),
      ),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('Erfasst als R-049')).toBeInTheDocument();
  });

  it('cancelt den alten GET und hält die Antwort im Overlay, ohne einen Singleton-Cache zu erfinden', async () => {
    const alt = {
      ...person,
      id: 46,
      registrier_nr: 46,
      status: 'vermisst' as const,
      name: 'Alt',
    };
    const neu = {
      ...person,
      id: 47,
      registrier_nr: 47,
      status: 'vermisst' as const,
      name: 'Neu',
    };
    let ersterAbrufGestartet!: () => void;
    let ersterAbrufFreigeben!: () => void;
    let zweiterAbrufGestartet!: () => void;
    let zweiterAbrufFreigeben!: () => void;
    const ersterStart = new Promise<void>((resolve) => {
      ersterAbrufGestartet = resolve;
    });
    const ersterGate = new Promise<void>((resolve) => {
      ersterAbrufFreigeben = resolve;
    });
    const zweiterStart = new Promise<void>((resolve) => {
      zweiterAbrufGestartet = resolve;
    });
    const zweiterGate = new Promise<void>((resolve) => {
      zweiterAbrufFreigeben = resolve;
    });
    let abrufe = 0;
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/personen', async () => {
        abrufe += 1;
        if (abrufe === 1) {
          ersterAbrufGestartet();
          await ersterGate;
          return HttpResponse.json([alt]);
        }
        zweiterAbrufGestartet();
        await zweiterGate;
        return HttpResponse.json([alt, neu]);
      }),
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(neu, { status: 201 })),
    );
    const { client } = renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
      </Routes>,
      { route: '/einsaetze/1/personen' },
    );

    await ersterStart;
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await zweiterStart;

    expect(await screen.findByText('R-047')).toBeInTheDocument();
    expect(client.getQueryData(einsatzKeys.personen(1))).toBeUndefined();
    await act(async () => {
      ersterAbrufFreigeben();
    });
    expect(client.getQueryData(einsatzKeys.personen(1))).toBeUndefined();

    await act(async () => {
      zweiterAbrufFreigeben();
    });
    await vi.waitFor(() =>
      expect(client.getQueryData(einsatzKeys.personen(1))).toEqual([alt, neu]),
    );
    expect(await screen.findByText('R-046')).toBeInTheDocument();
    expect(screen.getByText('R-047')).toBeInTheDocument();
  });

  it('lässt eine verspätete Online-Antwort aus Einsatz A in B weder Ansicht noch Modal ändern', async () => {
    const personA = {
      ...person,
      id: 77,
      registrier_nr: 77,
      status: 'vermisst' as const,
      name: 'Person A',
      vorname: null,
    };
    const personB = {
      ...person,
      id: 77,
      einsatz_id: 2,
      registrier_nr: 88,
      status: 'erfasst' as const,
      name: 'Person B',
      vorname: null,
    };
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => {
      postGestartet = resolve;
    });
    const antwortGate = new Promise<void>((resolve) => {
      antwortFreigeben = resolve;
    });
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const id = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatzAktiv, id, bezeichnung: `Einsatz ${id}` });
      }),
      http.get('/api/einsaetze/:einsatzId/personen', ({ params }) =>
        HttpResponse.json(params.einsatzId === '2' ? [personB] : []),
      ),
      http.post('/api/einsaetze/1/personen', async () => {
        postGestartet();
        await antwortGate;
        return HttpResponse.json(personA, { status: 201 });
      }),
    );
    const { container } = renderMitEinsatzNavigation();

    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Person A');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    expect(await screen.findByText('Person B')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Schnellerfassung' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Schnellerfassung');

    await act(async () => {
      antwortFreigeben();
    });
    await vi.waitFor(() => expect(screen.queryByText('Erfasst als R-077')).not.toBeInTheDocument());
    expect(screen.getByText('Person B')).toBeInTheDocument();
    expect(screen.queryByText('Person A')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-row-key="77"]')).not.toHaveClass('zeile-hervorgehoben');
    expect(screen.getByRole('dialog')).toHaveTextContent('Schnellerfassung');
  });

  it('ersetzt die Offline-Warnung nach korreliertem Flush durch Registriernummer und Highlight', async () => {
    const vermisst = {
      ...person,
      id: 48,
      registrier_nr: 48,
      status: 'vermisst' as const,
      name: 'Offline Neu',
    };
    const { client } = render(einsatzAktiv, []);
    const vermisstMelden = await screen.findByRole('button', { name: 'Vermisst melden' });
    // Online geladen, dann fällt das Netz weg: so liegt es im Einsatz.
    setzeOnline(false);
    await userEvent.click(vermisstMelden);
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Offline Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();

    const [vorgemerkt] = await schreibaktionenLaden(1, 1);
    if (vorgemerkt.aktion.art !== 'person') throw new Error('Personenaktion erwartet');
    await act(async () => {
      client.setQueryData(einsatzKeys.personen(1), [vermisst]);
      window.dispatchEvent(
        new CustomEvent(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, {
          detail: {
            art: 'person',
            benutzerId: 1,
            einsatzId: 1,
            clientId: vorgemerkt.aktion.daten.client_id,
            daten: vermisst,
          },
        }),
      );
    });

    expect(await screen.findByText('Erfasst als R-048')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    expect((await screen.findByText('R-048')).closest('tr')).toHaveClass('zeile-hervorgehoben');
  });

  it('liefert die Personen-Quittung nach Unmount und globalem Flush beim Remount genau einmal aus', async () => {
    const vermisst = {
      ...person,
      id: 49,
      registrier_nr: 49,
      status: 'vermisst' as const,
      name: 'Nach Reload',
    };
    const post = vi.fn();
    server.use(
      http.post('/api/einsaetze/1/personen', async ({ request }) => {
        const body = (await request.json()) as { client_id?: string; status?: string };
        post(body);
        return HttpResponse.json(vermisst, { status: 201 });
      }),
    );

    const ersteSeite = render(einsatzAktiv, []);
    const vermisstMelden = await screen.findByRole('button', { name: 'Vermisst melden' });
    // Online geladen, dann fällt das Netz weg: so liegt es im Einsatz.
    setzeOnline(false);
    await userEvent.click(vermisstMelden);
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Nach Reload');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
    ersteSeite.unmount();

    setzeOnline(true);
    const globalerSync = renderMitProviders(<OfflineSyncTest benutzerId={nutzer.id} />);
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    await vi.waitFor(async () =>
      expect(await queueZaehlerLaden(nutzer.id, 1)).toMatchObject({ ausstehend: 0 }),
    );
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1),
    );
    expect(await personErfassungsQuittungenLaden(2, 1)).toHaveLength(0);
    expect(await personErfassungsQuittungenLaden(nutzer.id, 2)).toHaveLength(0);
    globalerSync.unmount();

    const zweiteSeite = render(einsatzAktiv, [vermisst]);
    expect(await screen.findByText('Erfasst als R-049')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    expect((await screen.findByText('R-049')).closest('tr')).toHaveClass('zeile-hervorgehoben');
    // Render allein ist kein globaler Ack: ein anderer sichtbarer Tab muss die Quittung nach seinem
    // datenarmen Signal noch aus IDB lesen können.
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);
    const schliessen = quittungSchliessenButton();
    if (!schliessen) throw new Error('Schließen-Knopf der Quittung fehlt');
    await userEvent.click(schliessen);
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(0),
    );
    zweiteSeite.unmount();

    render(einsatzAktiv, [vermisst]);
    await screen.findByRole('heading', { name: /Betroffene/ });
    expect(screen.queryByText('Erfasst als R-049')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
  });

  it('sendet tabübergreifend ausschließlich den Receipt-Scope ohne Personendaten', () => {
    const kanalPerson: Person = {
      ...person,
      id: 50,
      registrier_nr: 50,
      status: 'vermisst' as const,
      name: 'Nicht im Kanal',
    };
    meldeOfflineSchreibaktionGesendet({
      art: 'person',
      benutzerId: nutzer.id,
      einsatzId: 1,
      clientId: 'nicht-im-kanal',
      daten: kanalPerson,
      sicht: 'vermisst',
    });

    expect(FakeBroadcastChannel.instanzen).toHaveLength(1);
    expect(FakeBroadcastChannel.instanzen[0].postMessage).toHaveBeenCalledWith({
      typ: 'person-erfassungsquittung',
      benutzerId: nutzer.id,
      einsatzId: 1,
    });
    const payload = FakeBroadcastChannel.instanzen[0].postMessage.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('Nicht im Kanal');
    expect(JSON.stringify(payload)).not.toContain('nicht-im-kanal');
    expect(Object.keys(payload)).toEqual(['typ', 'benutzerId', 'einsatzId']);
  });

  it('liest im bereits gemounteten Zweittab nach Scope-Signal aus IDB und quittiert erst explizit', async () => {
    const crossTabPerson: Person = {
      ...person,
      id: 50,
      registrier_nr: 50,
      status: 'vermisst' as const,
      name: 'Aus anderem Tab',
    };
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: /Betroffene/ });
    await schreibaktionEinreihen(nutzer.id, 1, {
      art: 'person',
      daten: { name: 'Aus anderem Tab', status: 'vermisst', client_id: 'cross-tab-50' },
    });
    const [pending] = await schreibaktionenLaden(nutzer.id, 1);
    expect(
      await schreibaktionPersonAbschliessen(nutzer.id, pending, crossTabPerson),
    ).not.toBeNull();

    const kanal = FakeBroadcastChannel.instanzen[0];
    await act(async () => {
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung',
        benutzerId: 2,
        einsatzId: 1,
      });
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung',
        benutzerId: nutzer.id,
        einsatzId: 2,
      });
    });
    expect(screen.queryByText('Erfasst als R-050')).not.toBeInTheDocument();

    await act(async () => {
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung',
        benutzerId: nutzer.id,
        einsatzId: 1,
      });
    });
    expect(await screen.findByText('Erfasst als R-050')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    expect((await screen.findByText('R-050')).closest('tr')).toHaveClass('zeile-hervorgehoben');

    // Wiederholtes Signal und konkurrierender Re-Read bleiben idempotent; erst das explizite
    // Schließen ist der persistente Ack.
    await act(async () => {
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung',
        benutzerId: nutzer.id,
        einsatzId: 1,
      });
    });
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);
    expect(screen.getAllByText('Erfasst als R-050')).toHaveLength(1);
    const schliessen = quittungSchliessenButton();
    if (!schliessen) throw new Error('Schließen-Knopf der Quittung fehlt');
    await userEvent.click(schliessen);
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(0),
    );
  });

  it('behält das Receipt im Hintergrund und lädt/quittiert es erst nach visible erneut', async () => {
    const hintergrundPerson: Person = {
      ...person,
      id: 51,
      registrier_nr: 51,
      status: 'betroffen' as const,
      name: 'Im Hintergrund',
    };
    await schreibaktionEinreihen(nutzer.id, 1, {
      art: 'person',
      daten: { name: 'Im Hintergrund', status: 'betroffen', client_id: 'hidden-51' },
    });
    const [pending] = await schreibaktionenLaden(nutzer.id, 1);
    await schreibaktionPersonAbschliessen(nutzer.id, pending, hintergrundPerson);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    render(einsatzAktiv, []);
    expect(await screen.findByText('Erfasst als R-051')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    expect(quittungSchliessenButton()).not.toBeInTheDocument();
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(quittungSchliessenButton()).toBeInTheDocument());
    const schliessen = quittungSchliessenButton();
    if (!schliessen) throw new Error('Schließen-Knopf der Quittung fehlt');
    // visibilitychange hat erneut aus IDB gelesen, aber nicht automatisch gelöscht.
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);
    await userEvent.click(schliessen);
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(0),
    );
  });

  it('ordnet auch einen Offline-Abschluss nach dem Routewechsel ausschließlich Einsatz A zu', async () => {
    const personA = {
      ...person,
      id: 78,
      registrier_nr: 78,
      status: 'vermisst' as const,
      name: 'Offline A',
      vorname: null,
    };
    const personB = {
      ...person,
      id: 78,
      einsatz_id: 2,
      registrier_nr: 89,
      status: 'erfasst' as const,
      name: 'Person B',
      vorname: null,
    };
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const id = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatzAktiv, id, bezeichnung: `Einsatz ${id}` });
      }),
      http.get('/api/einsaetze/:einsatzId/personen', ({ params }) =>
        HttpResponse.json(params.einsatzId === '2' ? [personB] : []),
      ),
    );
    const { container } = renderMitEinsatzNavigation();
    const vermisstMelden = await screen.findByRole('button', { name: 'Vermisst melden' });
    // Online geladen, dann fällt das Netz weg: so liegt es im Einsatz.
    setzeOnline(false);
    await userEvent.click(vermisstMelden);
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Offline A');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
    const [vorgemerkt] = await schreibaktionenLaden(1, 1);
    if (vorgemerkt.aktion.art !== 'person') throw new Error('Personenaktion erwartet');

    // Das Netz ist zurück, bevor Einsatz B geladen wird.
    setzeOnline(true);
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    expect(await screen.findByText('Person B')).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, {
          detail: {
            art: 'person',
            benutzerId: 1,
            einsatzId: 1,
            clientId: vorgemerkt.aktion.daten.client_id,
            daten: personA,
          },
        }),
      );
    });

    expect(screen.queryByText('Erfasst als R-078')).not.toBeInTheDocument();
    expect(screen.queryByText('Offline A')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-row-key="78"]')).not.toHaveClass('zeile-hervorgehoben');

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz A' }));
    expect(await screen.findByText('Offline A')).toBeInTheDocument();
    expect(screen.getByText('Erfasst als R-078')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-row-key="78"]')).toHaveClass('zeile-hervorgehoben');
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [person]);
    await screen.findByText('R-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Kurzeingabe Person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Person erfassen' })).not.toBeInTheDocument();
  });

  it('leitet den Alt-Deep-Link ?person=<id> auf die Detailseite um', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person], '/einsaetze/1/personen?person=10');
    // Redirect → Detailseite rendert die Überschrift:
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
  });

  it('zeigt die Sichtung als BBK-Etikett und zählt das Sichtungsbild der Seitenleiste', async () => {
    const gesichtet = {
      ...person,
      id: 12,
      registrier_nr: 3,
      status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const,
      aktuelle_sichtung_at: '2026-05-27 09:30:00',
    };
    render(einsatzAktiv, [person, unbekannt, gesichtet]);
    await screen.findByText('R-001');
    // Das Etikett in der Zeile ist der `SichtungsTag` (BBK-Farbfeld), keine Designfarbe.
    const zeile = (await screen.findByText('R-003')).closest('tr')!;
    expect(zeile.querySelector('[data-sichtung="sk2"]')).toHaveTextContent('SK II');

    const bild = screen.getByRole('region', { name: 'Sichtungsbild' });
    expect(bild.querySelector('[data-lfh="summe"]')).toHaveTextContent('3');
    const reihe = (k: string) => bild.querySelector(`[data-sichtung-zeile="${k}"]`)!;
    expect(reihe('sk2')).toHaveTextContent(/SK II.*schwer.*1$/);
    expect(reihe('ohne')).toHaveTextContent(/ohne Sichtung.*2$/);
    expect(reihe('sk1')).toHaveTextContent(/0$/);
    expect(within(bild).getByRole('img')).toHaveAccessibleName(
      'Betroffene nach Sichtung: SK I 0, SK II 1, SK III 0, SK IV 0, tot 0, unverletzt 0, ohne Sichtung 2',
    );
  });

  it('zählt Verbleib und offene Felder nur über angetroffene Personen', async () => {
    const mitVerbleib = {
      ...person,
      id: 21,
      registrier_nr: 21,
      status: 'betroffen' as const,
      aktueller_verbleib: 'Transport → KH Nord',
      aktuelle_verbleib_art: 'transport' as const,
    };
    const inUhs = {
      ...person,
      id: 22,
      registrier_nr: 22,
      status: 'betroffen' as const,
      aktuelle_uhs_id: 7,
      antreff_ort: null,
    };
    server.use(
      http.get('/api/einsaetze/:einsatzId/uhs', () =>
        HttpResponse.json([
          { id: 7, einsatz_id: 1, bezeichnung: 'Weserstadion', typ: 'uhs', status: 'aktiv' },
        ]),
      ),
    );
    // `person` (erfasst, ohne Verbleib) ist offen; `unbekannt` (vermisst) zählt nicht.
    render(einsatzAktiv, [person, unbekannt, mitVerbleib, inUhs]);
    await screen.findByText('R-001');

    const verbleib = screen.getByRole('region', { name: 'Verbleib' });
    await vi.waitFor(() =>
      expect(verbleib.querySelector('[data-verbleib="uhs:7"]')).toHaveTextContent('Weserstadion1'),
    );
    expect(verbleib.querySelector('[data-verbleib="transport"]')).toHaveTextContent('Transport1');
    expect(verbleib.querySelector('[data-verbleib="offen"]')).toHaveTextContent('offen1');

    const offen = screen.getByRole('region', { name: 'Offene Felder' });
    expect(offen.querySelector('[data-lfh="offene-felder"]')).toHaveTextContent(
      /^1 ohne Verbleib, 1 ohne Fundort — 2 Datensätze\./,
    );
    // Die Verbleib-Zelle nennt die UHS beim Namen.
    expect((await screen.findByText('R-022')).closest('tr')).toHaveTextContent('UHS Weserstadion');
  });

  it('tönt Lückenzeilen und schreibt das Wort dazu; „Nur Lücken zeigen" filtert darauf', async () => {
    const vollstaendig = {
      ...person,
      id: 23,
      registrier_nr: 23,
      status: 'betroffen' as const,
      aktueller_verbleib: 'entlassen',
      aktuelle_verbleib_art: 'entlassung' as const,
    };
    render(einsatzAktiv, [person, vollstaendig, unbekannt]);
    const offen = (await screen.findByText('R-001')).closest('tr')!;
    expect(offen).toHaveClass('zeile-luecke');
    // Zweiter Kanal: das Wort in der Personenzelle, nicht nur die Tönung.
    expect(offen).toHaveTextContent('Verbleib offen');
    const voll = screen.getByText('R-023').closest('tr')!;
    expect(voll).not.toHaveClass('zeile-luecke');
    // Regex statt Teilstring: „betroffen" enthält „offen".
    expect(voll).not.toHaveTextContent(/(Verbleib|Fundort) offen/);
    // Vermisst ist keine Lücke — sie hat naturgemäß weder Fundort noch Verbleib.
    expect(screen.getByText('R-002').closest('tr')).not.toHaveClass('zeile-luecke');

    const knopf = screen.getByRole('button', { name: 'Nur Lücken zeigen' });
    expect(knopf).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(knopf);
    expect(knopf).toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() => expect(regFolge()).toEqual(['R-001']));

    // Gegenhälfte: aus wieder an → alle drei zurück.
    await userEvent.click(knopf);
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
  });

  it('Sichtungsraster gruppiert ALLE Personen nach Sichtung, samt unverletzt und ohne Sichtung', async () => {
    const sk2 = {
      ...person,
      id: 12,
      registrier_nr: 3,
      status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const,
      aktuelle_sichtung_at: '2026-05-27 09:30:00',
    };
    const totVerstorben = {
      ...person,
      id: 13,
      registrier_nr: 4,
      status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const,
      aktuelle_sichtung_at: '2026-05-27 09:40:00',
    };
    const unverletzt = {
      ...person,
      id: 14,
      registrier_nr: 5,
      status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const,
      aktuelle_sichtung_at: '2026-05-27 09:50:00',
    };
    render(einsatzAktiv, [person, sk2, totVerstorben, unverletzt]);
    await screen.findByText('R-001');
    const ansicht = screen.getByRole('radiogroup', { name: 'Ansicht' });
    expect(within(ansicht).getByRole('radio', { name: 'Zeilen' })).toBeChecked();
    // Die dritte Ansicht ist die Karte der Fundorte — eigener Test unten.
    expect(within(ansicht).getByRole('radio', { name: 'Karte' })).not.toBeChecked();

    await userEvent.click(within(ansicht).getByRole('radio', { name: 'Sichtungsraster' }));
    expect(
      await screen.findByRole('region', { name: 'Betroffene nach Sichtungskategorie' }),
    ).toBeInTheDocument();
    // Die Gruppenachse erscheint im Tabellenzweig als Zählerstreifen der Werkzeugzeile, keine
    // synthetischen Zwischenzeilen.
    expect(screen.getByText('SK II · 1')).toBeInTheDocument();
    expect(screen.getByText('tot · 1')).toBeInTheDocument();
    expect(screen.getByText('unverletzt · 1')).toBeInTheDocument();
    expect(screen.getByText('ohne Sichtung · 1')).toBeInTheDocument();
    // Dringlichkeit zuerst: SK II vor tot vor unverletzt vor ohne Sichtung.
    await vi.waitFor(() => expect(regFolge()).toEqual(['R-003', 'R-004', 'R-005', 'R-001']));
    // Der Statusfilter gilt auch im Raster.
    await userEvent.click(screen.getByRole('tab', { name: 'Verstorben' }));
    await vi.waitFor(() => expect(regFolge()).toEqual(['R-004']));
  });

  it('öffnet via ?neu=1 die Schnellerfassung (die Maske, nicht die Zeile)', async () => {
    render(einsatzAktiv, [], '/einsaetze/1/personen?neu=1');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Schnellerfassung');
  });

  it('öffnet via ?neu=1 die Schnellerfassung NICHT für Beobachter', async () => {
    render(einsatzBeobachter, [], '/einsaetze/1/personen?neu=1');
    // Seite lädt durch (Tabelle leer, kein Spinner mehr)
    await screen.findByRole('heading', { name: /Betroffene/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sortiert die Liste selbst, statt die Lieferreihenfolge zu übernehmen', async () => {
    // Die Fixture liegt absichtlich verdreht: das Backend liefert `ORDER BY registrier_nr`
    // aufsteigend, msw gibt das Array unverändert heraus. In Backend-Reihenfolge wäre der Test auch
    // ohne Sortiercode grün.
    const drei = [
      { ...person, id: 30, registrier_nr: 3, status: 'betroffen' as const },
      { ...person, id: 31, registrier_nr: 1 },
      { ...person, id: 32, registrier_nr: 2, status: 'vermisst' as const },
    ];
    render(einsatzAktiv, drei);
    await screen.findByText('R-001');
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    // Jüngste Registrierung oben: die zuletzt Erfasste steht dort, wo die Erfassungszeile ist.
    expect(regFolge()).toEqual(['R-003', 'R-002', 'R-001']);
  });

  it('zeigt die Zeit und ordnet im Raster dieselbe SK ältester-zuerst', async () => {
    /**
     * Alle Bestandsfixtures teilen `erfasst_at`; eine Zeitsortier-Behauptung über gleiche
     * Zeitstempel wäre eine Attrappe. Diese beiden tragen verschiedene Sichtungszeitpunkte, die
     * spätere wird zuerst geliefert.
     */
    const spaet = {
      ...person,
      id: 40,
      registrier_nr: 8,
      status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const,
      aktuelle_sichtung_at: '2026-05-27 09:40:00',
    };
    const frueh = {
      ...person,
      id: 41,
      registrier_nr: 9,
      status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const,
      aktuelle_sichtung_at: '2026-05-27 09:10:00',
    };
    render(einsatzAktiv, [spaet, frueh]);
    await userEvent.click(await screen.findByRole('radio', { name: 'Sichtungsraster' }));
    await vi.waitFor(() => expect(regFolge()).toHaveLength(2));
    // Die Spalte existiert überhaupt …
    expect(screen.getByRole('columnheader', { name: /Zeit/ })).toBeInTheDocument();
    // … und trägt eine taktische DTG `DDHHmm` (Muster, kein Fixwert — Lokalzeit des Testrechners) …
    const dtg = screen.getAllByText(/^\d{6}$/).map((e) => e.textContent);
    expect(dtg).toHaveLength(2);
    // … mit zwei verschiedenen Werten: beide Fixtures teilen `erfasst_at` und `geaendert_at`, nur
    // der Sichtungszeitpunkt unterscheidet sie.
    expect(new Set(dtg).size).toBe(2);
    // … und die ältere Sichtung steht oben, obwohl die jüngere zuerst geliefert wurde.
    expect(regFolge()).toEqual(['R-009', 'R-008']);
  });

  it('gibt nur BELEGTEN SK-Gruppen einen Zähler', async () => {
    const sk2 = {
      ...person,
      id: 50,
      registrier_nr: 3,
      status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const,
      aktuelle_sichtung_at: '2026-05-27 09:30:00',
    };
    const tot = {
      ...person,
      id: 51,
      registrier_nr: 4,
      status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const,
      aktuelle_sichtung_at: '2026-05-27 09:40:00',
    };
    render(einsatzAktiv, [sk2, tot]);
    await userEvent.click(await screen.findByRole('radio', { name: 'Sichtungsraster' }));
    expect(await screen.findByText('SK II · 1')).toBeInTheDocument();
    expect(screen.getByText('tot · 1')).toBeInTheDocument();
    /**
     * Die tragende Hälfte: SK I, III und IV stehen in der festen Gruppenfolge, haben aber keine
     * Zeile. Emittierte `gruppiere` sie mit Zähler 0, zöge lautlos ein „SK I · 0" ein. `^`-Anker,
     * weil „SK I" sonst in „SK II" matcht.
     */
    expect(screen.queryByText(/^SK I · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^SK III · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^SK IV · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^ohne Sichtung · /)).not.toBeInTheDocument();
  });

  it('trägt die Zeit in den Kartenzweig und ersetzt dort die Abgleich-Zelle durch einen Dialog', async () => {
    /**
     * Zwei Aussagen, die denselben Zweig brauchen:
     *
     * 1. Unter `md` rendert `Datensicht` den Kartenzweig, und die Zeit kommt dort aus dem
     *    `sekundaer`-Tupel — ein fehlender Slot wäre in jeder Tabellenprüfung unsichtbar.
     * 2. Die Abgleichspalte trägt ein 200 px breites Auswahlfeld, auf einer 390-px-Karte nicht
     *    bedienbar; der Aktions-Deskriptor ersetzt es durch Knopf plus Dialog.
     *
     * Breite vor dem Rendern setzen: antds Beobachter liest beim Abonnieren synchron.
     */
    setzeViewportBreite(390);
    const gefunden = { ...person, id: 20, registrier_nr: 7, status: 'betroffen' as const };
    const schmal = render(einsatzAktiv, [unbekannt, gefunden]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    await screen.findByRole('region', { name: 'Personen' });
    // Genau ein Zweig im Baum.
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    // Etikett und Wert — das Etikett ist der zweite Kanal der Karte.
    expect(screen.getByText('Zeit')).toBeInTheDocument();
    expect(screen.getByText(/^\d{6}$/)).toBeInTheDocument();
    // Das Tastaturziel der Zeile ist der Titel-Link, nicht die Kartenfläche.
    expect(screen.getByRole('link', { name: 'R-002' })).toHaveAttribute(
      'href',
      '/einsaetze/1/personen/11',
    );
    // Und die Primäraktion führt in den Dialog statt in eine 24-px-Zelle.
    await userEvent.click(screen.getByRole('button', { name: /Abgleich vorschlagen/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('R-002');
    expect(screen.getByRole('combobox', { name: 'gefundene Person' })).toBeInTheDocument();
  });

  it('navigiert beim Klick auf eine Zeile zur Detailseite', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person]);
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    // Die Detailseite zeigt den Personen-Titel als Überschrift:
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
  });

  it('rendert genau einen Datensatz-Link pro Personenzeile', async () => {
    render(einsatzAktiv, [person, unbekannt]);

    const links = await screen.findAllByRole('link', { name: /^R-00[12]$/ });
    expect(links).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'R-001' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'R-002' })).toHaveLength(1);
  });

  /**
   * Partnerpaar: die negative Hälfte allein belegte nichts; erst der Fall darunter mit gleichem
   * Literal macht daraus eine Aussage über die Zustandsweiche.
   *
   * Beide Leertexte der Seite stehen im Paar: die Listensicht bedient fünf Reiter, der
   * Patienten-Zweig hat einen eigenen Text — die Fehlerweiche muss beide verdrängen.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT die Leertexte', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
      </Routes>,
      { route: '/einsaetze/1/personen' },
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByText('Personen konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine Personen in dieser Sicht')).not.toBeInTheDocument();
    // Die Seitenleiste zählt aus derselben Menge — über dem Fehler meldete sie „0 erfasst", eine
    // nie erhobene Zahl.
    expect(screen.queryByRole('region', { name: 'Sichtungsbild' })).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Menge die Leertexte und KEINEN Fehler', async () => {
    render(einsatzAktiv, []);

    expect(await screen.findByText('Keine Personen in dieser Sicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Sichtungsraster' }));
    expect(await screen.findByText('Keine Personen in dieser Sicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` mit Zeilen im Zwischenspeicher — nicht `isFetching`, nicht
   * `isStale`.
   *
   * Der Ablauf ist der echte: erst ein geglückter Abruf, dann eine gescheiterte Aktualisierung. Ein
   * bloß vorbefüllter Zwischenspeicher ließe ungeprüft, ob TanStack nach einem
   * Hintergrund-Fehlschlag auf `error` stellt (statt nur `isRefetchError`); er tut es und behält
   * `data` — genau die Lage des Banners.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = render(einsatzAktiv, [person]);
    await screen.findByText('R-001');

    server.use(
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 500 })),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.personen(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeilen aus dem Zwischenspeicher bleiben stehen — der Fehler verdrängt sie nicht.
    expect(screen.getByText('R-001')).toBeInTheDocument();
    expect(screen.queryByText('Personen konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  /** Rechteentzug (LFH-723, design.md D6): eine 403 ist kein „veralteter Stand" — der
   *  entzogene Stand verschwindet, statt unter einem Hinweis stehen zu bleiben. */
  it('zeigt nach einer 403 den Fehler statt des entzogenen Stands', async () => {
    const { client } = render(einsatzAktiv, [person]);
    await screen.findByText('R-001');

    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }),
      ),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.personen(1) });

    expect(await screen.findByText('Personen konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('R-001')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).not.toBeInTheDocument();
  });

  describe('Erfassungszeile /person', () => {
    const feld = () => screen.getByRole('textbox', { name: 'Kurzeingabe Person' });

    it('erfasst in Serie: EIN POST mit Sichtung und client_id, Feld leer, Fokus bleibt, Quittung aus der Antwort', async () => {
      const koerper: Record<string, unknown>[] = [];
      const antworten = [
        {
          ...person,
          id: 60,
          registrier_nr: 60,
          status: 'betroffen',
          name: 'Kowalski',
          vorname: 'Anna',
          geschlecht: 'weiblich',
          alter_geschaetzt: 34,
          aktuelle_sichtung: 'sk3',
          antreff_ort: null,
        },
        {
          ...person,
          id: 61,
          registrier_nr: 61,
          status: 'betroffen',
          name: 'Hoffmann',
          vorname: null,
          aktuelle_sichtung: 'sk2',
          antreff_ort: null,
        },
      ];
      server.use(
        http.post('/api/einsaetze/1/personen', async ({ request }) => {
          koerper.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(antworten[koerper.length - 1], { status: 201 });
        }),
      );
      render(einsatzAktiv, []);
      await userEvent.type(
        await screen.findByRole('textbox', { name: 'Kurzeingabe Person' }),
        'Kowalski, Anna w 34 sk3',
      );
      // Erkannte Teile stehen als Marken darunter — die Sichtung als BBK-`SichtungsTag`.
      const erkannt = document.querySelector('[data-lfh="erkannt"]')!;
      expect(erkannt).toHaveTextContent('Kowalski, Anna');
      expect(erkannt.querySelector('[data-sichtung="sk3"]')).toHaveTextContent('SK III');

      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() => expect(feld()).toHaveValue(''));
      expect(koerper[0]).toMatchObject({
        name: 'Kowalski',
        vorname: 'Anna',
        geschlecht: 'weiblich',
        alter_geschaetzt: 34,
        sichtung: 'sk3',
        status: 'erfasst',
        client_id: expect.any(String),
      });
      expect(koerper[0]).not.toHaveProperty('uhs_id');
      await vi.waitFor(() => expect(feld()).toHaveFocus());
      const zuletzt = document.querySelector('[data-lfh="zuletzt"]')!;
      expect(zuletzt).toHaveTextContent(/^Zuletzt: \d{4} R-060 Kowalski, Anna · SK III$/);
      // Die Zeile quittiert an sich selbst — kein Alert je Person, der weggeklickt werden müsste.
      expect(screen.queryByText(/Erfasst als R-060/)).not.toBeInTheDocument();
      // … und die neue Zeile steht hervorgehoben in der Liste.
      expect((await screen.findByText('R-060')).closest('tr')).toHaveClass('zeile-hervorgehoben');

      // Zweiter Datensatz, direkt weiter — per Knopf statt Enter, derselbe Weg.
      await userEvent.type(feld(), 'Hoffmann SK II');
      await userEvent.click(screen.getByRole('button', { name: 'Person erfassen' }));
      await vi.waitFor(() => expect(koerper).toHaveLength(2));
      expect(koerper[1]).toMatchObject({ name: 'Hoffmann', sichtung: 'sk2' });
      expect(koerper[1].client_id).not.toBe(koerper[0].client_id);
      await vi.waitFor(() =>
        expect(document.querySelector('[data-lfh="zuletzt"]')).toHaveTextContent(
          /R-061 Hoffmann · SK II$/,
        ),
      );
    });

    it('löst „@" auf eine UHS auf und schickt uhs_id im SELBEN POST', async () => {
      let koerper: Record<string, unknown> | undefined;
      server.use(
        http.get('/api/einsaetze/:einsatzId/uhs', () =>
          HttpResponse.json([
            { id: 7, einsatz_id: 1, bezeichnung: 'Weserstadion', typ: 'uhs', status: 'aktiv' },
          ]),
        ),
        http.post('/api/einsaetze/1/personen', async ({ request }) => {
          koerper = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            { ...person, id: 62, registrier_nr: 62, aktuelle_uhs_id: 7 },
            { status: 201 },
          );
        }),
      );
      render(einsatzAktiv, []);
      await userEvent.type(
        await screen.findByRole('textbox', { name: 'Kurzeingabe Person' }),
        'Bauer sk3 @weser',
      );
      await vi.waitFor(() =>
        expect(document.querySelector('[data-lfh="erkannt"]')).toHaveTextContent(
          '→ UHS Weserstadion',
        ),
      );
      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() =>
        expect(koerper).toMatchObject({ name: 'Bauer', sichtung: 'sk3', uhs_id: 7 }),
      );
    });

    it('sendet bei unerkanntem Kürzel NICHT und sagt warum; der Wortlaut bleibt stehen', async () => {
      const post = vi.fn();
      server.use(
        http.post('/api/einsaetze/1/personen', () => {
          post();
          return HttpResponse.json(person, { status: 201 });
        }),
      );
      render(einsatzAktiv, []);
      await userEvent.type(
        await screen.findByRole('textbox', { name: 'Kurzeingabe Person' }),
        'Meier #52.1 sk3',
      );
      await userEvent.keyboard('{Enter}');
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /Nicht erfasst: .*Koordinate unbrauchbar/,
      );
      expect(post).not.toHaveBeenCalled();
      expect(feld()).toHaveValue('Meier #52.1 sk3');
    });

    it('der Kürzel-Hinweis bleibt beim Tippen stehen, unsichtbar und aus der Beschreibung genommen (LFH-650)', async () => {
      /**
       * Der mehrzeilige Hinweis und die kürzere Erkennungszeile liegen gestapelt, damit der Inhalt
       * darunter mit dem ersten Zeichen nicht springt. Die Höhe misst
       * `e2e/betroffene-layout.spec.ts`; hier steht die Struktur samt Gegenhälfte, dass Vorlesende
       * den verdeckten Hinweis nicht hören.
       */
      render(einsatzAktiv, []);
      const zeile = await screen.findByRole('textbox', { name: 'Kurzeingabe Person' });
      expect(zeile).toHaveAccessibleDescription(/#Koordinate \(52\.2691\/9\.1342\)/);
      await userEvent.type(zeile, 'Kowalski sk2');
      const hinweis = screen.getByText('#Koordinate (52.2691/9.1342)').parentElement!;
      expect(hinweis).toHaveStyle({ visibility: 'hidden' });
      expect(hinweis).toHaveAttribute('aria-hidden', 'true');
      expect(zeile).toHaveAccessibleDescription(/^erkannt:/);
      expect(zeile).not.toHaveAccessibleDescription(/Kürzel/);
    });

    it('schickt die Koordinate aus „#lat/lon“ im SELBEN POST (LFH-613, Spec-Szenario)', async () => {
      let koerper: Record<string, unknown> | undefined;
      server.use(
        http.post('/api/einsaetze/1/personen', async ({ request }) => {
          koerper = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            {
              ...person,
              id: 63,
              registrier_nr: 63,
              status: 'betroffen',
              name: 'Kowalski',
              vorname: 'Anna',
              aktuelle_sichtung: 'sk3',
              antreff_lat: 52.2691,
              antreff_lon: 9.1342,
            },
            { status: 201 },
          );
        }),
      );
      render(einsatzAktiv, []);
      const zeile = await screen.findByRole('textbox', { name: 'Kurzeingabe Person' });
      // Die leere Zeile nennt das Kürzel — sonst wäre es nur über den Code auffindbar.
      expect(screen.getByText('#Koordinate (52.2691/9.1342)')).toBeInTheDocument();
      await userEvent.type(zeile, 'Kowalski, Anna w 34 sk3 #52.2691/9.1342');
      expect(document.querySelector('[data-lfh="erkannt"]')).toHaveTextContent('#52.2691/9.1342');
      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() => expect(koerper).toBeDefined());
      expect(koerper).toMatchObject({
        name: 'Kowalski',
        vorname: 'Anna',
        geschlecht: 'weiblich',
        alter_geschaetzt: 34,
        sichtung: 'sk3',
        antreff_lat: 52.2691,
        antreff_lon: 9.1342,
        client_id: expect.any(String),
      });
      // Der Name bleibt frei von der Koordinate.
      expect(koerper!.name).toBe('Kowalski');
    });

    it('tut bei leerer Eingabe nichts — kein POST, keine Meldung', async () => {
      const post = vi.fn();
      server.use(http.post('/api/einsaetze/1/personen', () => (post(), HttpResponse.json(person))));
      render(einsatzAktiv, []);
      await userEvent.type(
        await screen.findByRole('textbox', { name: 'Kurzeingabe Person' }),
        '   {Enter}',
      );
      expect(post).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('zeigt 422 mit dem Wortlaut des Servers an der Zeile und behält die Eingabe', async () => {
      server.use(
        http.post('/api/einsaetze/1/personen', () =>
          HttpResponse.json({ error: 'Sichtung passt nicht zum Status' }, { status: 422 }),
        ),
      );
      render(einsatzAktiv, []);
      await userEvent.type(
        await screen.findByRole('textbox', { name: 'Kurzeingabe Person' }),
        'Meier sk1{Enter}',
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Nicht erfasst: Sichtung passt nicht zum Status',
      );
      expect(feld()).toHaveValue('Meier sk1');
      // Weitertippen räumt die Meldung.
      await userEvent.type(feld(), 'x');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('merkt offline vor (client_id, Sichtung in der vorgemerkten Anlage) und leert das Feld', async () => {
      render(einsatzAktiv, []);
      const kurzeingabe = await screen.findByRole('textbox', { name: 'Kurzeingabe Person' });
      // Online geladen, dann fällt das Netz weg: so liegt es im Einsatz.
      setzeOnline(false);
      await userEvent.type(kurzeingabe, 'Neumann, Ilse w 84 sk2{Enter}');
      await vi.waitFor(() => expect(feld()).toHaveValue(''));
      expect(document.querySelector('[data-lfh="zuletzt"]')).toHaveTextContent(
        'Zuletzt: offline vorgemerkt · Neumann, Ilse · SK II',
      );
      expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
      const [vorgemerkt] = await schreibaktionenLaden(nutzer.id, 1);
      if (vorgemerkt.aktion.art !== 'person') throw new Error('Personenaktion erwartet');
      expect(vorgemerkt.aktion.daten).toMatchObject({
        name: 'Neumann',
        vorname: 'Ilse',
        sichtung: 'sk2',
        client_id: expect.any(String),
      });
    });
  });
});

/**
 * CSV-Export (LFH-728). Der Endpunkt verlangt nur Lesezugriff auf das Modul — dasselbe Recht wie
 * die Liste —, schreibt aber je Abruf einen Audit-Eintrag. Ein Abruf je Klick, nie beim Laden.
 */
describe('PersonenPage — CSV-Export (LFH-728)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lädt erst auf Klick, genau einmal, und speichert unter einem Dateinamen mit Einsatz', async () => {
    const speichern = vi.spyOn(dateiSpeichern, 'speichereDatei').mockImplementation(() => {});
    let abrufe = 0;
    server.use(
      http.get('/api/einsaetze/1/personen/export', () => {
        abrufe += 1;
        return new HttpResponse('registrier_nr;status\nR-001;"erfasst"\n');
      }),
    );
    render(einsatzAktiv, [person]);
    const knopf = await screen.findByRole('button', { name: 'CSV exportieren' });
    expect(abrufe).toBe(0);

    await userEvent.click(knopf);
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    expect(abrufe).toBe(1);
    const [datei, name] = speichern.mock.calls[0];
    expect(await (datei as Blob).text()).toContain('R-001');
    expect(name).toMatch(/^personen-einsatz-1-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
  });

  it('steht auch für Beobachter im Kopf', async () => {
    render(einsatzBeobachter, [person]);
    const kopf = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(within(kopf).getByRole('button', { name: 'CSV exportieren' })).toBeInTheDocument();
    expect(within(kopf).queryByRole('button', { name: 'Schnellerfassung' })).toBeNull();
  });

  it('zeigt den Fehler an der Seite neben dem Abschluss-Hinweis, nicht im Toast', async () => {
    const speichern = vi.spyOn(dateiSpeichern, 'speichereDatei').mockImplementation(() => {});
    server.use(
      http.get('/api/einsaetze/1/personen/export', () =>
        HttpResponse.json({ error: 'Kein Zugriff auf das Modul Personen' }, { status: 403 }),
      ),
    );
    render(einsatzFixture({ status: 'abgeschlossen' }), [person]);
    await userEvent.click(await screen.findByRole('button', { name: 'CSV exportieren' }));

    const meldung = await screen.findByText('Kein Zugriff auf das Modul Personen');
    expect(meldung.closest('.ant-message')).toBeNull();
    expect(meldung.closest('.ant-alert')).not.toBeNull();
    expect(screen.getByText('Export fehlgeschlagen')).toBeInTheDocument();
    expect(screen.getByText('Einsatz ist abgeschlossen — nur Ansicht.')).toBeInTheDocument();
    expect(speichern).not.toHaveBeenCalled();
  });
});

/**
 * Sichtvorgabe aus der URL — der Anspringweg der Sprungmarken „Patienten" und „Vermisste". Beide
 * Hälften von apply-then-clean: die Sicht steht und die Parameter sind weg. Nur die erste wäre auch
 * grün, wenn die Seite den Filter bloß aus der URL spiegelte.
 */
describe('PersonenPage — Sichtvorgabe aus der URL (LFH-620)', () => {
  function Suche() {
    return <output data-testid="suche">{useLocation().search}</output>;
  }

  function renderMitSuche(route: string) {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([person, unbekannt])),
      http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    );
    return renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/:id/personen"
          element={
            <>
              <Suche />
              <PersonenPage />
            </>
          }
        />
      </Routes>,
      { route },
    );
  }

  it('?filter=vermisst setzt den Statusfilter und räumt den Parameter', async () => {
    renderMitSuche('/einsaetze/1/personen?filter=vermisst&ansicht=zeilen');
    expect(await screen.findByText('R-002')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vermisst', selected: true })).toBeInTheDocument();
    // Die erfasste Person steht unter „Vermisst" nicht — die Vorgabe wirkt auf die Zeilen.
    expect(screen.queryByText('R-001')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
  });

  it('?ansicht=raster öffnet das Sichtungsraster über alle Personen', async () => {
    renderMitSuche('/einsaetze/1/personen?ansicht=raster&filter=alle');
    expect(
      await screen.findByRole('region', { name: 'Betroffene nach Sichtungskategorie' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
  });

  it('?ansicht=karte öffnet die Kartenansicht und räumt den Parameter', async () => {
    server.use(
      http.get('/api/karte/config', () => HttpResponse.json({})),
      http.get('/api/einsaetze/1/karten-ansichten', () => HttpResponse.json([])),
    );
    renderMitSuche('/einsaetze/1/personen?ansicht=karte');
    // Keine Person trägt eine Koordinate, der Einsatz keinen Ort: Leerzustand, und die Lücke ist
    // gezählt — nur die angetroffene, die vermisste hat keinen Fundort.
    expect(await screen.findByText('Keine Person mit Koordinate')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Karte' })).toBeChecked();
    expect(screen.getByText('1 Person ohne Koordinate — nicht auf der Karte')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
  });

  it('räumt einen unbrauchbaren Wert, ohne die Sicht zu verbiegen', async () => {
    // Behält andere Parameter: nur der Sichtauftrag wird geräumt.
    renderMitSuche('/einsaetze/1/personen?filter=patienten&x=1');
    await screen.findByText('R-001');
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Zeilen' })).toBeChecked();
    await vi.waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent('?x=1'));
  });
});

/**
 * Kartenansicht der Betroffenen, mit gestubbter `Kartenflaeche` (Kopf der Datei). Die
 * Marker-Auswahl prüft `personen/personenKarte.test.ts` ohne Render; hier geht es um den Weg durch
 * die Seite: wählbar, lazy geladen, die richtigen Marker übergeben, die Lücke genannt, der Klick
 * führt zur Detailseite.
 */
describe('PersonenPage — Kartenansicht (LFH-613)', () => {
  function Ort() {
    return <output data-testid="ort">{useLocation().pathname}</output>;
  }

  function renderKarte(personen: unknown[], einsatzObj: EinsatzAnzeige = einsatzAktiv) {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
      http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
      http.get('/api/karte/config', () => HttpResponse.json({})),
      http.get('/api/einsaetze/1/karten-ansichten', () => HttpResponse.json([])),
    );
    return renderMitProviders(
      <>
        <Ort />
        <Routes>
          <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
          <Route path="/einsaetze/:id/personen/:personId" element={<p>Detailseite</p>} />
        </Routes>
      </>,
      { route: '/einsaetze/1/personen' },
    );
  }

  const mitKoordinate = (id: number, reg: number, extra: Partial<Person> = {}): Person => ({
    ...person,
    id,
    registrier_nr: reg,
    status: 'betroffen',
    antreff_lat: 52.26 + id / 1000,
    antreff_lon: 9.13,
    ...extra,
  });

  async function waehleKarte() {
    await screen.findByText('R-001');
    const ansicht = screen.getByRole('radiogroup', { name: 'Ansicht' });
    await userEvent.click(within(ansicht).getByRole('radio', { name: 'Karte' }));
  }

  it('zeigt zwei Marker mit Registriernummer und Sichtung und nennt „3 ohne Koordinate“ (Spec-Szenario)', async () => {
    const personen = [
      person, // R-001, ohne Koordinate
      { ...unbekannt }, // R-002, vermisst: kein Fundort, also auch keine Lücke
      { ...person, id: 12, registrier_nr: 7 }, // R-007, ohne Koordinate
      { ...person, id: 15, registrier_nr: 3, antreff_lat: 52.1, antreff_lon: null }, // halbes Paar
      mitKoordinate(20, 4, { aktuelle_sichtung: 'sk2' }),
      mitKoordinate(21, 5),
      // Storniert: weder Marker noch Lücke.
      mitKoordinate(22, 6, { storniert_at: '2026-05-27 10:00:00' }),
    ];
    renderKarte(personen);
    await waehleKarte();

    expect(await screen.findByTestId('kartenflaeche-stub')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'marker-person-20: R-004 · SK II' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'marker-person-21: R-005 · ohne Sichtung' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /marker-person-22/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^marker-person-/ })).toHaveLength(2);
    expect(
      screen.getByText('3 Personen ohne Koordinate — nicht auf der Karte'),
    ).toBeInTheDocument();
    // Startausschnitt: Rahmen um die zwei Personen, nicht die Weltübersicht.
    expect(JSON.parse(screen.getByTestId('startansicht').textContent ?? 'null')).toMatchObject({
      art: 'rahmen',
    });
    // Die Liste ist in dieser Ansicht nicht gerendert — die Karte ersetzt sie.
    expect(screen.queryByRole('region', { name: 'Personen' })).not.toBeInTheDocument();
  });

  it('ohne Lücke SAGT die Hinweiszeile es, statt zu verschwinden — kein Kartensprung (LFH-650)', async () => {
    /**
     * Die Zeile steht immer, nicht nur bei `> 0`: sonst spränge die Karte um eine Zeile, wenn die
     * letzte Person live verortet wird. Die e2e-Spec misst den Sprung.
     */
    // Beide angetroffenen Personen tragen eine Koordinate — R-001 bleibt der Anker von
    // `waehleKarte`.
    renderKarte([mitKoordinate(person.id, person.registrier_nr), mitKoordinate(20, 4)]);
    await waehleKarte();
    await screen.findByTestId('kartenflaeche-stub');
    expect(
      screen.getByText('Alle angetroffenen Personen dieser Auswahl stehen auf der Karte'),
    ).toBeInTheDocument();
  });

  it('ohne Lücke und ohne Marker behauptet der Hinweis KEINE vollständige Karte (Review LFH-650)', async () => {
    // Filter „Vermisst": keine angetroffene Person in der Auswahl. „Alle stehen auf der Karte" über
    // einer leeren Karte wäre falsch.
    renderKarte([mitKoordinate(person.id, person.registrier_nr), { ...unbekannt }], {
      ...einsatzAktiv,
      einsatzort_lat: 52.3,
      einsatzort_lon: 9.2,
    });
    await waehleKarte();
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(
      await screen.findByText('Keine angetroffene Person in dieser Auswahl'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/stehen auf der Karte/)).not.toBeInTheDocument();
  });

  it('der Markerklick führt zur Detailseite der Person', async () => {
    renderKarte([person, mitKoordinate(20, 4)]);
    await waehleKarte();
    await userEvent.click(await screen.findByRole('button', { name: /marker-person-20/ }));
    expect(await screen.findByText('Detailseite')).toBeInTheDocument();
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/personen/20');
  });

  it('der Statusfilter gilt auch auf der Karte', async () => {
    renderKarte([
      person,
      mitKoordinate(20, 4, { status: 'betroffen' }),
      mitKoordinate(21, 5, { status: 'verstorben' }),
    ]);
    await waehleKarte();
    await screen.findByTestId('kartenflaeche-stub');
    expect(screen.getAllByRole('button', { name: /^marker-person-/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('tab', { name: 'Verstorben' }));
    await vi.waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^marker-person-/ })).toHaveLength(1),
    );
    expect(screen.getByRole('button', { name: /marker-person-21/ })).toBeInTheDocument();
  });

  it('ohne Person mit Koordinate steht der Einsatzort als Startausschnitt, nicht der Leerzustand', async () => {
    renderKarte([person], { ...einsatzAktiv, einsatzort_lat: 52.3, einsatzort_lon: 9.2 });
    await waehleKarte();
    await screen.findByTestId('kartenflaeche-stub');
    expect(screen.queryByText('Keine Person mit Koordinate')).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('startansicht').textContent ?? 'null')).toMatchObject({
      art: 'punkt',
      lat: 52.3,
      lng: 9.2,
    });
    // Der Einsatzort ist kein Personenziel: sein Klick navigiert nicht.
    await userEvent.click(screen.getByRole('button', { name: /^marker-einsatzort/ }));
    expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/personen$/);
    expect(screen.getByText('1 Person ohne Koordinate — nicht auf der Karte')).toBeInTheDocument();
  });

  it('ohne Koordinate und ohne Einsatzort: Leerzustand statt einer leeren Karte', async () => {
    renderKarte([person]);
    await waehleKarte();
    expect(await screen.findByText('Keine Person mit Koordinate')).toBeInTheDocument();
    expect(screen.queryByTestId('kartenflaeche-stub')).not.toBeInTheDocument();
  });
});
