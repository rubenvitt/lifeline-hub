import { http, HttpResponse } from 'msw';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
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

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
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
  await queueLeerenFuerTests();
});
afterEach(() => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.unstubAllGlobals();
});

// Normaler Benutzer (kein System-Admin): so prüfen die Rollen-Tests die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1, anzeigename: 'Nutzer', benutzername: 'nutzer', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const person: Person = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
  name: 'Mustermann', vorname: 'Max', geschlecht: 'maennlich', geburtsdatum: null,
  alter_geschaetzt: 40, herkunft_adresse: null, antreff_ort: 'Brücke', melder_kontakt: null,
  notiz: null, erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1, storniert_at: null,
};
const unbekannt = { ...person, id: 11, registrier_nr: 2, name: null, vorname: null, status: 'vermisst' };

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

function render(einsatzObj: typeof einsatzAktiv, personen: unknown[], route = '/einsaetze/1/personen') {
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
          element={<><EinsatzNavigation /><PersonenPage /></>}
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
  it('zeigt Personen der Sicht „Neu" mit Registriernummer und Status', async () => {
    render(einsatzAktiv, [person, unbekannt]);
    expect(await screen.findByText('R-001')).toBeInTheDocument();
    expect(screen.getByText('Mustermann, Max')).toBeInTheDocument();
    // unbekannt (vermisst) ist in der Default-Sicht „Neu" (erfasst) NICHT sichtbar:
    expect(screen.queryByText('R-002')).not.toBeInTheDocument();
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
    const mueller = { ...person, id: 60, registrier_nr: 11, status: 'vermisst' as const,
      name: 'Müller', vorname: 'Anna' };
    const krause = { ...person, id: 61, registrier_nr: 12, status: 'vermisst' as const,
      name: 'Krause', vorname: 'Bernd' };
    const schmidt = { ...person, id: 62, registrier_nr: 13, status: 'betroffen' as const,
      name: 'Schmidt', vorname: 'Carla' };
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

  it('Einsatzleitung sieht die Anlege-Buttons', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Personen' });
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Betroffene/n erfassen' })).toBeInTheDocument();
  });

  it('bestätigt die Registriernummer, wechselt in die Zielsicht und hebt die neue Person hervor', async () => {
    const vermisst = {
      ...person,
      id: 47,
      registrier_nr: 47,
      status: 'vermisst' as const,
      name: 'Neu',
    };
    server.use(
      http.post('/api/einsaetze/1/personen', async ({ request }) => {
        const body = await request.json() as { status?: string; client_id?: string };
        expect(body.status).toBe('vermisst');
        expect(body.client_id).toBeTruthy();
        return HttpResponse.json(vermisst, { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('Erfasst als R-047')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vermisst', selected: true })).toBeInTheDocument();
    const kennung = await screen.findByText('R-047');
    expect(kennung.closest('tr')).toHaveClass('zeile-hervorgehoben');
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
    const ersterStart = new Promise<void>((resolve) => { ersterAbrufGestartet = resolve; });
    const ersterGate = new Promise<void>((resolve) => { ersterAbrufFreigeben = resolve; });
    const zweiterStart = new Promise<void>((resolve) => { zweiterAbrufGestartet = resolve; });
    const zweiterGate = new Promise<void>((resolve) => { zweiterAbrufFreigeben = resolve; });
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
    await userEvent.type(screen.getByLabelText('Name'), 'Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await zweiterStart;

    expect(await screen.findByText('R-047')).toBeInTheDocument();
    expect(client.getQueryData(einsatzKeys.personen(1))).toBeUndefined();
    await act(async () => { ersterAbrufFreigeben(); });
    expect(client.getQueryData(einsatzKeys.personen(1))).toBeUndefined();

    await act(async () => { zweiterAbrufFreigeben(); });
    await vi.waitFor(() => expect(client.getQueryData(einsatzKeys.personen(1))).toEqual([alt, neu]));
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
    const postStart = new Promise<void>((resolve) => { postGestartet = resolve; });
    const antwortGate = new Promise<void>((resolve) => { antwortFreigeben = resolve; });
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const id = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatzAktiv, id, bezeichnung: `Einsatz ${id}` });
      }),
      http.get('/api/einsaetze/:einsatzId/personen', ({ params }) =>
        HttpResponse.json(params.einsatzId === '2' ? [personB] : [])),
      http.post('/api/einsaetze/1/personen', async () => {
        postGestartet();
        await antwortGate;
        return HttpResponse.json(personA, { status: 201 });
      }),
    );
    const { container } = renderMitEinsatzNavigation();

    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Person A');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    expect(await screen.findByText('Person B')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Schnellerfassung' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Schnellerfassung');

    await act(async () => { antwortFreigeben(); });
    await vi.waitFor(() => expect(screen.queryByText('Erfasst als R-077')).not.toBeInTheDocument());
    expect(screen.getByText('Person B')).toBeInTheDocument();
    expect(screen.queryByText('Person A')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Neu' })).toHaveAttribute('aria-selected', 'true');
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
    await userEvent.type(screen.getByLabelText('Name'), 'Offline Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();

    const [vorgemerkt] = await schreibaktionenLaden(1, 1);
    if (vorgemerkt.aktion.art !== 'person') throw new Error('Personenaktion erwartet');
    await act(async () => {
      client.setQueryData(einsatzKeys.personen(1), [vermisst]);
      window.dispatchEvent(new CustomEvent(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, {
        detail: {
          art: 'person',
          benutzerId: 1,
          einsatzId: 1,
          clientId: vorgemerkt.aktion.daten.client_id,
          daten: vermisst,
        },
      }));
    });

    expect(await screen.findByText('Erfasst als R-048')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vermisst', selected: true })).toBeInTheDocument();
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
        const body = await request.json() as { client_id?: string; status?: string };
        post(body);
        return HttpResponse.json(vermisst, { status: 201 });
      }),
    );

    const ersteSeite = render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Nach Reload');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
    ersteSeite.unmount();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const globalerSync = renderMitProviders(<OfflineSyncTest benutzerId={nutzer.id} />);
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    await vi.waitFor(async () =>
      expect(await queueZaehlerLaden(nutzer.id, 1)).toMatchObject({ ausstehend: 0 }));
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1));
    expect(await personErfassungsQuittungenLaden(2, 1)).toHaveLength(0);
    expect(await personErfassungsQuittungenLaden(nutzer.id, 2)).toHaveLength(0);
    globalerSync.unmount();

    const zweiteSeite = render(einsatzAktiv, [vermisst]);
    expect(await screen.findByText('Erfasst als R-049')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vermisst', selected: true })).toBeInTheDocument();
    expect((await screen.findByText('R-049')).closest('tr'))
      .toHaveClass('zeile-hervorgehoben');
    // Render allein ist kein globaler Ack: ein anderer sichtbarer Tab muss das
    // Receipt nach seinem datenarmen Signal noch aus IDB lesen können.
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);
    const schliessen = quittungSchliessenButton();
    if (!schliessen) throw new Error('Schließen-Knopf der Quittung fehlt');
    await userEvent.click(schliessen);
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(0));
    zweiteSeite.unmount();

    render(einsatzAktiv, [vermisst]);
    await screen.findByRole('heading', { name: 'Personen' });
    expect(screen.queryByText('Erfasst als R-049')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Neu', selected: true })).toBeInTheDocument();
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
    await screen.findByRole('heading', { name: 'Personen' });
    await schreibaktionEinreihen(nutzer.id, 1, {
      art: 'person',
      daten: { name: 'Aus anderem Tab', status: 'vermisst', client_id: 'cross-tab-50' },
    });
    const [pending] = await schreibaktionenLaden(nutzer.id, 1);
    expect(await schreibaktionPersonAbschliessen(nutzer.id, pending, crossTabPerson))
      .not.toBeNull();

    const kanal = FakeBroadcastChannel.instanzen[0];
    await act(async () => {
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung', benutzerId: 2, einsatzId: 1,
      });
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung', benutzerId: nutzer.id, einsatzId: 2,
      });
    });
    expect(screen.queryByText('Erfasst als R-050')).not.toBeInTheDocument();

    await act(async () => {
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung', benutzerId: nutzer.id, einsatzId: 1,
      });
    });
    expect(await screen.findByText('Erfasst als R-050')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vermisst', selected: true })).toBeInTheDocument();
    expect((await screen.findByText('R-050')).closest('tr'))
      .toHaveClass('zeile-hervorgehoben');

    // Wiederholtes Signal und konkurrierender Re-Read bleiben idempotent; erst
    // das explizite Schließen ist der persistente Ack.
    await act(async () => {
      kanal.sendeAusAnderemTab({
        typ: 'person-erfassungsquittung', benutzerId: nutzer.id, einsatzId: 1,
      });
    });
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);
    expect(screen.getAllByText('Erfasst als R-050')).toHaveLength(1);
    const schliessen = quittungSchliessenButton();
    if (!schliessen) throw new Error('Schließen-Knopf der Quittung fehlt');
    await userEvent.click(schliessen);
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(0));
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
    expect(screen.getByRole('tab', { name: 'Betroffen', selected: true })).toBeInTheDocument();
    expect(quittungSchliessenButton()).not.toBeInTheDocument();
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await vi.waitFor(() => expect(quittungSchliessenButton()).toBeInTheDocument());
    const schliessen = quittungSchliessenButton();
    if (!schliessen) throw new Error('Schließen-Knopf der Quittung fehlt');
    // visibilitychange hat erneut aus IDB gelesen, aber nicht automatisch gelöscht.
    expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(1);
    await userEvent.click(schliessen);
    await vi.waitFor(async () =>
      expect(await personErfassungsQuittungenLaden(nutzer.id, 1)).toHaveLength(0));
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
        HttpResponse.json(params.einsatzId === '2' ? [personB] : [])),
    );
    const { container } = renderMitEinsatzNavigation();
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Offline A');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
    const [vorgemerkt] = await schreibaktionenLaden(1, 1);
    if (vorgemerkt.aktion.art !== 'person') throw new Error('Personenaktion erwartet');

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    expect(await screen.findByText('Person B')).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, {
        detail: {
          art: 'person',
          benutzerId: 1,
          einsatzId: 1,
          clientId: vorgemerkt.aktion.daten.client_id,
          daten: personA,
        },
      }));
    });

    expect(screen.queryByText('Erfasst als R-078')).not.toBeInTheDocument();
    expect(screen.queryByText('Offline A')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Neu' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-row-key="78"]')).not.toHaveClass('zeile-hervorgehoben');

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz A' }));
    expect(await screen.findByText('Offline A')).toBeInTheDocument();
    expect(screen.getByText('Erfasst als R-078')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vermisst' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-row-key="78"]')).toHaveClass('zeile-hervorgehoben');
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [person]);
    await screen.findByText('R-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('leitet den Alt-Deep-Link ?person=<id> auf die Detailseite um', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person], '/einsaetze/1/personen?person=10');
    // Redirect → Detailseite rendert den Heading:
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
  });

  it('zeigt SK-Badge und Lagebild-Zählungen', async () => {
    const gesichtet = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    render(einsatzAktiv, [person, unbekannt, gesichtet]);
    // Liste-Sicht „Alle" wählen, dann nach SK-Tag suchen
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
    expect(await screen.findByText('SK II')).toBeInTheDocument();
    // Lagebild: „SK II: 1", „ungesichtet: 2" (person + unbekannt)
    expect(screen.getByText(/SK II:\s*1/)).toBeInTheDocument();
    expect(screen.getByText(/ungesichtet:\s*2/)).toBeInTheDocument();
  });

  it('Patienten-Tab gruppiert SK I–IV + tot in Abschnitte, ohne unverletzt/ungesichtet', async () => {
    const sk2 = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const totVerstorben = { ...person, id: 13, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const unverletzt = { ...person, id: 14, registrier_nr: 5, status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const, aktuelle_sichtung_at: '2026-05-27 09:50:00' };
    render(einsatzAktiv, [person, sk2, totVerstorben, unverletzt]);
    await screen.findByText('R-001'); // ungesichtete Person im „Neu"-Tab
    await userEvent.click(screen.getByRole('tab', { name: 'Patienten' }));
    // SK-II-Abschnitt + tot-Abschnitt: beide Patienten sichtbar:
    expect(await screen.findByText('R-003')).toBeInTheDocument();
    expect(screen.getByText('R-004')).toBeInTheDocument();
    // Zwei belegte Gruppen mit je einem Patienten. Die Gruppenachse erscheint im
    // Tabellenzweig als Zählerstreifen der Werkzeugzeile („SK II · 1"), NICHT als
    // Zwischenkopfzeile — synthetische Gruppenzeilen sind bei unbedingt fixierter Spalte 0
    // ungeprüft (API-Entscheidung §9.8).
    expect(screen.getByText('SK II · 1')).toBeInTheDocument();
    expect(screen.getByText('tot · 1')).toBeInTheDocument();
    // unverletzt (R-005) und ungesichtet (R-001) sind KEINE Patienten:
    expect(screen.queryByText('R-005')).not.toBeInTheDocument();
    expect(screen.queryByText('R-001')).not.toBeInTheDocument();
    // Achsen-Überlappung: verstorben+tot erscheint AUCH im Verstorben-Tab:
    await userEvent.click(screen.getByRole('tab', { name: 'Verstorben' }));
    expect(await screen.findByText('R-004')).toBeInTheDocument();
  });

  it('Patienten-Tab zeigt einen Leer-Hinweis, wenn niemand gesichtet ist', async () => {
    render(einsatzAktiv, [person, unbekannt]); // beide ungesichtet
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Patienten' }));
    expect(await screen.findByText(/Keine Patienten/)).toBeInTheDocument();
  });

  it('Lagebild-Streifen zeigt „Patienten: N" (SK I–IV + tot)', async () => {
    const sk2 = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const tot = { ...person, id: 13, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const unverletzt = { ...person, id: 14, registrier_nr: 5, status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const, aktuelle_sichtung_at: '2026-05-27 09:50:00' };
    render(einsatzAktiv, [person, sk2, tot, unverletzt]);
    await screen.findByText('R-001');
    // Patienten = sk2 + tot = 2 (unverletzt + ungesichtet zählen nicht):
    expect(await screen.findByText(/Patienten:\s*2/)).toBeInTheDocument();
  });

  it('öffnet via ?neu=1 die Schnellerfassung', async () => {
    render(einsatzAktiv, [], '/einsaetze/1/personen?neu=1');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Schnellerfassung');
  });

  it('öffnet via ?neu=1 die Schnellerfassung NICHT für Beobachter', async () => {
    render(einsatzBeobachter, [], '/einsaetze/1/personen?neu=1');
    // Seite lädt durch (Tabelle ist leer, kein Spinner mehr)
    await screen.findByRole('heading', { name: 'Personen' });
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
    await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    expect(regFolge()).toEqual(['R-001', 'R-002', 'R-003']);
  });

  it('zeigt „seit" und ordnet Patienten derselben SK ältester-zuerst', async () => {
    /**
     * FALLE, gemessen: alle Bestandsfixtures sind aus `person` gespreizt und teilen
     * `erfasst_at: '2026-05-27 09:00:00'`. Eine Zeitsortier-Behauptung über gleiche
     * Zeitstempel ist eine Attrappe — diese beiden Personen tragen deshalb VERSCHIEDENE
     * Sichtungszeitpunkte, und die spätere wird zuerst geliefert.
     */
    const spaet = { ...person, id: 40, registrier_nr: 8, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const frueh = { ...person, id: 41, registrier_nr: 9, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:10:00' };
    render(einsatzAktiv, [spaet, frueh]);
    // Auf den REITER warten, nicht auf eine Zeile: beide Personen sind `betroffen` und
    // damit im Vorgabe-Reiter „Neu" unsichtbar.
    await userEvent.click(await screen.findByRole('tab', { name: 'Patienten' }));
    await vi.waitFor(() => expect(regFolge()).toHaveLength(2));
    // Die Spalte existiert überhaupt …
    expect(screen.getByRole('columnheader', { name: /seit/ })).toBeInTheDocument();
    // … und trägt eine taktische DTG (Muster, kein Fixwert — Lokalzeit des Testrechners) …
    const dtg = screen
      .getAllByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/)
      .map((e) => e.textContent);
    expect(dtg).toHaveLength(2);
    // … mit ZWEI VERSCHIEDENEN Werten: beide Fixtures teilen `erfasst_at` und `geaendert_at`,
    // also blieb ein `render` auf einem dieser Felder grün, solange nur das Format geprüft
    // wurde. Nur der Sichtungszeitpunkt unterscheidet sie.
    expect(new Set(dtg).size).toBe(2);
    // … und die ältere Sichtung steht oben, obwohl die jüngere zuerst geliefert wurde.
    expect(regFolge()).toEqual(['R-009', 'R-008']);
  });

  it('gibt nur BELEGTEN SK-Gruppen einen Zähler', async () => {
    const sk2 = { ...person, id: 50, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const tot = { ...person, id: 51, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    render(einsatzAktiv, [sk2, tot]);
    // Reiter statt Zeile abwarten: beide Personen sind im Vorgabe-Reiter „Neu" unsichtbar.
    await userEvent.click(await screen.findByRole('tab', { name: 'Patienten' }));
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
  });

  it('trägt „seit" in den Kartenzweig und ersetzt dort die Abgleich-Zelle durch einen Dialog', async () => {
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
    expect(screen.getByText('seit')).toBeInTheDocument();
    expect(
      screen.getByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/),
    ).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('tab', { name: 'Alle' }));

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
    expect(screen.queryByText('Keine Patienten in diesem Einsatz.')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Menge die Leertexte und KEINEN Fehler', async () => {
    render(einsatzAktiv, []);

    expect(await screen.findByText('Keine Personen in dieser Sicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Patienten' }));
    expect(await screen.findByText('Keine Patienten in diesem Einsatz.')).toBeInTheDocument();
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
});
