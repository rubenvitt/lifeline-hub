import { http, HttpResponse } from 'msw';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { server } from '../test/server';
import { setzeViewportBreite } from '../test/viewport';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
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

/**
 * Die echte Karte braucht WebGL (MapLibre), jsdom hat keins — Stub nach dem Muster von
 * `LagekartePage.test.tsx`. Er macht sichtbar, WAS die Kartenansicht der Betroffenen an
 * die Karte übergibt (Marker samt Beschriftung, Startausschnitt), und bietet je Marker einen
 * Knopf, der den Klick so meldet wie die echte Karte. Ob die Marker tatsächlich gezeichnet
 * werden, belegt `e2e/betroffene-karte.spec.ts` über `window.__lfhKarte`.
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

class FakeEventSource {
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}

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
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  // Die Seite lädt die Unfallhilfsstellen für `@UHS` und die Verbleib-Spalte; ohne eigene
  // Angabe eines Tests gibt es keine.
  server.use(http.get('/api/einsaetze/:einsatzId/uhs', () => HttpResponse.json([])));
  await queueLeerenFuerTests();
});
afterEach(() => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.unstubAllGlobals();
});

// Normaler Benutzer (kein System-Admin): so prüfen die Rollen-Tests die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1,
  anzeigename: 'Nutzer',
  benutzername: 'nutzer',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-27 10:00:00',
};
const einsatzAktiv = {
  id: 1,
  bezeichnung: 'Hochwasser',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  einsatzart: 'realeinsatz',
  einsatznummer_intern: null,
  angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null,
  einsatzort: null,
  einsatzort_lat: null,
  einsatzort_lon: null,
  meldende_stelle: null,
  sachverhalt: null,
  anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

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
 * Zeilenfolge der Registriernummern in Dokumentordnung.
 *
 * Warum die FOLGE und nicht ein gerenderter Zeitstring: `renderMitProviders` hängt keinen
 * `EinsatzAnzeigeProvider` ein, `useAnzeigeKonventionen` fällt also auf Lokalzeit zurück —
 * eine Behauptung über „271100MAI2026" prüfte die Zeitzone des Testrechners. Die Folge ist
 * ohnehin genau das, was „sortierbar" behauptet.
 *
 * `getAllByText` vergleicht nur DIREKTE Textkinder, deshalb liefert die verschachtelte
 * Titelzelle (`<a><span><strong>R-001</strong></span></a>`) genau einen Treffer je Zeile.
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
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
        <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
      </Routes>
    </AuthProvider>,
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
    <AuthProvider>
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
      </Routes>
    </AuthProvider>,
    { route },
  );
}

function OfflineSyncTest({ benutzerId }: { benutzerId: number }) {
  useOfflineSync(benutzerId);
  return null;
}

describe('PersonenPage', () => {
  it('zeigt in der Vorgabe ALLE Personen; der Filter „Neu" zeigt nur erfasste', async () => {
    // Vorgabe „Alle" statt des früheren „Neu": eine über die Zeile MIT Sichtung erfasste
    // Person hebt der Server auf `betroffen` — unter „Neu" verschwände sie beim Erfassen.
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
     * EINE `Datensicht` bedient fünf Reiter — sie stehen alle im selben Zweig des
     * Ternärs. Bei konstantem `key` reicht React beim Reiterwechsel dieselbe Instanz
     * weiter, und `suchbegriff` lebt IN der Sicht: der Begriff aus „Vermisst" filtert
     * danach die Menge von „Betroffen".
     *
     * Drei Schritte, weil der letzte allein nichts belegte: eine Behauptung über das
     * leere Feld bliebe auch grün, wenn die Suche überhaupt nicht filterte (etwa ohne
     * `suchText` an der Namensspalte). Schritt 1 zeigt erst, dass der Begriff wirkt;
     * Schritt 3 nennt den Schaden beim Namen — eine fremde Menge auf einen fremden
     * Begriff gefiltert.
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
   * LFH-340 · C5. Der Kopf kam aus einem handgebauten Block (Breadcrumb, `Title level={3}`,
   * Status-Tag, `Datenstand`, Schreibrecht-Alert) — also genau aus dem Slotsatz, den
   * `EinsatzSeite` seit LFH-328 · A2 trägt. Die zweite Zeile ist die tragende: „level 1 da"
   * allein wäre auch grün, wenn der Handbau daneben stehen bliebe.
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
    // Ein Filter, der die neue Person VERBIRGT: er muss auf „Alle" zurückfallen, sonst stünde
    // die Hervorhebung an einer Zeile, die gar nicht angezeigt wird.
    await userEvent.click(await screen.findByRole('tab', { name: 'Neu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    // Der Name liegt seit LFH-340 · C5 unter „Weitere Angaben" — für diesen Fall genügt der
    // Antreffort, die Maske hat ohnehin keine Pflichtfelder.
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Brücke');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('Erfasst als R-047')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle', selected: true })).toBeInTheDocument();
    const kennung = await screen.findByText('R-047');
    expect(kennung.closest('tr')).toHaveClass('zeile-hervorgehoben');
  });

  /**
   * Die Quittung nennt die Sichtung mit (LFH-340 · C5). Sie kommt aus der ANTWORT, nicht aus
   * den gesendeten Werten: das Backend schreibt die Sichtung in derselben Transaktion und
   * kann sie mit 422 verwerfen — aus dem Formularwert gelesen behauptete die Quittung dann
   * eine Kategorie, die es nie gab.
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
    // Die Gegenhälfte: ohne sie wäre der Fall oben auch grün, wenn dort immer ein Zusatz
    // stünde — etwa ein „undefined" aus einem fehlenden Nachschlag.
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
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
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
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
        </Routes>
      </AuthProvider>,
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
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
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
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const vermisst = {
      ...person,
      id: 48,
      registrier_nr: 48,
      status: 'vermisst' as const,
      name: 'Offline Neu',
    };
    const { client } = render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
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
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
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
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Nach Reload');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
    ersteSeite.unmount();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
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
    // Render allein ist kein globaler Ack: ein anderer sichtbarer Tab muss das
    // Receipt nach seinem datenarmen Signal noch aus IDB lesen können.
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

    // Wiederholtes Signal und konkurrierender Re-Read bleiben idempotent; erst
    // das explizite Schließen ist der persistente Ack.
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
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
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
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const id = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatzAktiv, id, bezeichnung: `Einsatz ${id}` });
      }),
      http.get('/api/einsaetze/:einsatzId/personen', ({ params }) =>
        HttpResponse.json(params.einsatzId === '2' ? [personB] : []),
      ),
    );
    const { container } = renderMitEinsatzNavigation();
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Offline A');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
    const [vorgemerkt] = await schreibaktionenLaden(1, 1);
    if (vorgemerkt.aktion.art !== 'person') throw new Error('Personenaktion erwartet');

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
    // Redirect → Detailseite rendert den Heading:
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
    // Das Etikett in der Zeile ist der `SichtungsTag` (BBK-Farbfeld), nicht eine Designfarbe.
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
    // `person` (erfasst, ohne Verbleib) ist offen; `unbekannt` (vermisst) zählt NICHT.
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
    // Vermisst ist KEINE Lücke — sie hat naturgemäß weder Fundort noch Verbleib.
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
    // Die dritte Ansicht ist die Karte der Fundorte (LFH-613) — eigener Test unten.
    expect(within(ansicht).getByRole('radio', { name: 'Karte' })).not.toBeChecked();

    await userEvent.click(within(ansicht).getByRole('radio', { name: 'Sichtungsraster' }));
    expect(
      await screen.findByRole('region', { name: 'Betroffene nach Sichtungskategorie' }),
    ).toBeInTheDocument();
    // Die Gruppenachse erscheint im Tabellenzweig als Zählerstreifen der Werkzeugzeile —
    // KEINE synthetischen Zwischenzeilen (API-Entscheidung §9.8).
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
    // Seite lädt durch (Tabelle ist leer, kein Spinner mehr)
    await screen.findByRole('heading', { name: /Betroffene/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sortiert die Liste selbst, statt die Lieferreihenfolge zu übernehmen', async () => {
    // Die Fixture liegt ABSICHTLICH verdreht: das Backend liefert `ORDER BY registrier_nr`
    // aufsteigend (`src/person/repo.rs`), msw gibt das Array unverändert heraus. Eine in
    // Backend-Reihenfolge gelieferte Fixture wäre auch ohne eine Zeile Sortiercode grün.
    const drei = [
      { ...person, id: 30, registrier_nr: 3, status: 'betroffen' as const },
      { ...person, id: 31, registrier_nr: 1 },
      { ...person, id: 32, registrier_nr: 2, status: 'vermisst' as const },
    ];
    render(einsatzAktiv, drei);
    await screen.findByText('R-001');
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    // Jüngste Registrierung oben (Entwurf S7): die zuletzt Erfasste steht dort, wo die
    // Erfassungszeile ist.
    expect(regFolge()).toEqual(['R-003', 'R-002', 'R-001']);
  });

  it('zeigt die Zeit und ordnet im Raster dieselbe SK ältester-zuerst', async () => {
    /**
     * FALLE, gemessen: alle Bestandsfixtures sind aus `person` gespreizt und teilen
     * `erfasst_at: '2026-05-27 09:00:00'`. Eine Zeitsortier-Behauptung über gleiche
     * Zeitstempel ist eine Attrappe — diese beiden Personen tragen deshalb VERSCHIEDENE
     * Sichtungszeitpunkte, und die spätere wird zuerst geliefert.
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
    // … und trägt eine taktische DTG `DDHHmm` (Muster, kein Fixwert — Lokalzeit des
    // Testrechners) …
    const dtg = screen.getAllByText(/^\d{6}$/).map((e) => e.textContent);
    expect(dtg).toHaveLength(2);
    // … mit ZWEI VERSCHIEDENEN Werten: beide Fixtures teilen `erfasst_at` und `geaendert_at`,
    // also blieb ein `render` auf einem dieser Felder grün, solange nur das Format geprüft
    // wurde. Nur der Sichtungszeitpunkt unterscheidet sie.
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
     * Die tragende Hälfte: SK I, III und IV stehen in der festen Gruppenfolge, haben aber
     * keine Zeile. Emittierte `gruppiere` sie mit Zähler 0, zöge hier lautlos ein
     * „SK I · 0" ein — das ist die Regel, die `PersonenPage` vorher per
     * `if (gruppe.length === 0) return null` selbst hielt. `^`-Anker, weil „SK I" sonst in
     * „SK II" matcht.
     */
    expect(screen.queryByText(/^SK I · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^SK III · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^SK IV · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^ohne Sichtung · /)).not.toBeInTheDocument();
  });

  it('trägt die Zeit in den Kartenzweig und ersetzt dort die Abgleich-Zelle durch einen Dialog', async () => {
    /**
     * Zwei Aussagen in einem Fall, weil sie denselben Zweig brauchen:
     *
     * 1. Unter `md` rendert `Datensicht` genau einen ANDEREN Zweig, und die Zeit kommt dort
     *    aus dem `sekundaer`-Tupel. Ein dort fehlender Slot wäre in jeder Tabellenprüfung
     *    unsichtbar.
     * 2. Die Abgleichspalte trägt ein 200 px breites, ~24 px hohes Auswahlfeld in der Zelle.
     *    Auf einer 390-px-Karte ist das nicht bedienbar; der Aktions-Deskriptor ERSETZT es
     *    durch einen Knopf plus Dialog. Ohne diesen Fall wäre die Ersetzung eine Behauptung.
     *
     * Breite VOR dem Rendern setzen: antds Beobachter liest beim Abonnieren synchron.
     */
    setzeViewportBreite(390);
    const gefunden = { ...person, id: 20, registrier_nr: 7, status: 'betroffen' as const };
    const schmal = render(einsatzAktiv, [unbekannt, gefunden]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    await screen.findByRole('region', { name: 'Personen' });
    // Genau EIN Zweig im Baum.
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    // Etikett UND Wert — das Etikett ist der zweite Kanal der Karte.
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
    // Detailseite zeigt den Personen-Titel als Heading:
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
   * AK4-Pflichtstelle (LFH-331 · B3) — das Partnerpaar, nicht die einzelne Zusicherung.
   *
   * Die negative Hälfte allein belegte nichts: hätte der Umbau den Leertext umformuliert,
   * wäre sie auch im Leerfall trivial grün. Erst der Fall darunter — gleiches Literal,
   * gleiche Datei — macht aus ihr eine Aussage über die Zustandsweiche statt über die
   * Schreibweise eines Strings.
   *
   * Beide Leertexte der Seite stehen im Paar: die Listensicht bedient fünf Reiter, der
   * Patienten-Reiter ist ein eigener Zweig mit eigenem Text — die Fehlerweiche muss beide
   * verdrängen, sonst behauptet einer der zwei weiterhin eine leere Menge, wo bloß der
   * Abruf scheiterte.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT die Leertexte', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/personen' },
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByText('Personen konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine Personen in dieser Sicht')).not.toBeInTheDocument();
    // Die Seitenleiste zählt aus derselben Menge — über dem Fehler meldete sie „0 erfasst",
    // eine Zahl, die niemand erhoben hat.
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
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher — nicht `isFetching`, nicht
   * `isStale` (D5).
   *
   * Der Ablauf ist BEWUSST der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung derselben Sicht. Ein bloß vorbefüllter Zwischenspeicher belegte den
   * Produktionsweg NICHT — dort steht hinter den Zeilen nie ein erfolgreicher Abruf, und ob
   * TanStack den Zustand nach einem HINTERGRUND-Fehlschlag überhaupt auf `error` stellt
   * (statt die Meldung nur in `isRefetchError` abzulegen und `success` stehen zu lassen),
   * wäre damit ungeprüft geblieben. Gemessen: er tut es und behält `data` — genau die Lage,
   * die das Banner meint.
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
    // Die Zeilen aus dem Zwischenspeicher bleiben stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('R-001')).toBeInTheDocument();
    expect(screen.queryByText('Personen konnten nicht geladen werden')).not.toBeInTheDocument();
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
       * Bei 390 px sprang der Inhalt unter der Zeile mit dem ersten Zeichen 40 px nach oben,
       * weil der mehrzeilige Hinweis der kürzeren Erkennungszeile WICH (gemessen in
       * `e2e/betroffene-layout.spec.ts`). Jetzt liegen beide gestapelt; die Höhe misst die
       * e2e-Spec, hier steht die Struktur, aus der sie folgt — samt der Gegenhälfte, dass
       * Vorlesende den verdeckten Hinweis nicht mehr hören.
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
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      render(einsatzAktiv, []);
      await userEvent.type(
        await screen.findByRole('textbox', { name: 'Kurzeingabe Person' }),
        'Neumann, Ilse w 84 sk2{Enter}',
      );
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
 * Sichtvorgabe aus der URL (LFH-620) — der Anspringweg der Sprungmarken „Patienten" und
 * „Vermisste" im Modulpanel. Geprüft werden BEIDE Hälften von apply-then-clean: die Sicht
 * steht, UND die Parameter sind weg. Nur die erste Hälfte wäre auch mit einer Seite grün,
 * die den Filter bloß aus der URL spiegelt.
 */
describe('PersonenPage — Sichtvorgabe aus der URL (LFH-620)', () => {
  function Suche() {
    return <output data-testid="suche">{useLocation().search}</output>;
  }

  function renderMitSuche(route: string) {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([person, unbekannt])),
      http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    );
    return renderMitProviders(
      <AuthProvider>
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
        </Routes>
      </AuthProvider>,
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
    // Keine der beiden Personen trägt eine Koordinate, der Einsatz keinen Ort: Leerzustand,
    // und die Lücke ist gezählt — nur die ANGETROFFENE, die vermisste hat keinen Fundort.
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
 * Kartenansicht der Betroffenen (LFH-613, design D7) — mit gestubbter `Kartenflaeche`
 * (Kopf der Datei). Die Marker-Auswahl selbst prüft `personen/personenKarte.test.ts` ohne
 * Render; hier geht es um den Weg durch die Seite: wählbar, lazy geladen, die richtigen
 * Marker übergeben, die Lücke genannt, der Klick führt zur Detailseite.
 */
describe('PersonenPage — Kartenansicht (LFH-613)', () => {
  function Ort() {
    return <output data-testid="ort">{useLocation().pathname}</output>;
  }

  function renderKarte(
    personen: unknown[],
    einsatzObj: Omit<typeof einsatzAktiv, 'einsatzort_lat' | 'einsatzort_lon'> & {
      einsatzort_lat: number | null;
      einsatzort_lon: number | null;
    } = einsatzAktiv,
  ) {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
      http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
      http.get('/api/karte/config', () => HttpResponse.json({})),
      http.get('/api/einsaetze/1/karten-ansichten', () => HttpResponse.json([])),
    );
    return renderMitProviders(
      <AuthProvider>
        <Ort />
        <Routes>
          <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
          <Route path="/einsaetze/:id/personen/:personId" element={<p>Detailseite</p>} />
        </Routes>
      </AuthProvider>,
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
    // Die Liste ist in dieser Ansicht nicht gerendert — die Karte ERSETZT sie.
    expect(screen.queryByRole('region', { name: 'Personen' })).not.toBeInTheDocument();
  });

  it('ohne Lücke SAGT die Hinweiszeile es, statt zu verschwinden — kein Kartensprung (LFH-650)', async () => {
    /**
     * Befund Tabelle 4, Nr. 12 der LFH-613-Prüfliste: die Zeile stand nur bei `> 0` da. Wurde
     * die letzte Person live verortet, sprang die ganze Karte um eine Zeile unter dem Zeiger.
     * Jetzt steht sie immer; die e2e-Spec misst den Sprung im Browser.
     */
    // Beide angetroffenen Personen tragen eine Koordinate — R-001 bleibt der Anker von
    // `waehleKarte`.
    renderKarte([mitKoordinate(person.id, person.registrier_nr), mitKoordinate(20, 4)]);
    await waehleKarte();
    await screen.findByTestId('kartenflaeche-stub');
    expect(
      screen.getByText('Alle angetroffenen Personen stehen auf der Karte'),
    ).toBeInTheDocument();
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
