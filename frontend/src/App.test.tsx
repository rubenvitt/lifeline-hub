import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { neuerQueryClient } from './test/utils';
import { appRouten } from './App';
import { http, HttpResponse } from 'msw';
import { meHandler, server } from './test/server';
import { SITZUNG_ABGELAUFEN } from './auth/sitzungsEvent';
import { adminFixture, freigabenFixture } from './test/fixtures';
import { freiesRueckwegModul, modulZielRoute } from './einsatz/modulRegistry';
import { leseLetztenOrt } from './einsatz/letzterOrt';
import { setzeViewportBreite } from './test/viewport';

/**
 * Synthetisches WIP-Modul ohne `MODUL_ELEMENTE`-Eintrag: `App.tsx` wählt den Stub über die
 * Abwesenheit eines Elements, nicht über `status === 'wip'`. Ein echtes Registry-Modul bekäme
 * irgendwann ein Element, und die Stub-Tests prüften still die echte Seite.
 *
 * Gestubbt wird NUR die Datentabelle; die Freigabefunktionen bleiben die echten, sonst prüfte
 * der Test seine eigene Attrappe.
 */
vi.mock('./einsatz/modulRegistry', async (importOriginal) => {
  const echt = await importOriginal<typeof import('./einsatz/modulRegistry')>();
  return {
    ...echt,
    modulRegistry: [
      ...echt.modulRegistry,
      {
        key: 'wip-probe',
        kategorie: 'fuehrung',
        label: 'WIP-Probe',
        icon: () => null,
        route: 'wip-probe',
        status: 'wip',
        beschreibung: 'Platzhalter-Beschreibung für den Stellvertreter-Test.',
      },
    ],
  };
});

const admin = adminFixture();
const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
  // Pflichtfeld der API; der Überblick liest es für den Pegel-Platzhalter (LLH-2085).
  lagekennzahlen: [],
};

afterEach(() => vi.restoreAllMocks());

function renderApp(route: string) {
  const client = neuerQueryClient();
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  return {
    router,
    ...render(
      <QueryClientProvider client={client}>
        <ConfigProvider>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>,
    ),
  };
}

/** Titel der Platzhalterseite (LFH-595: Icon „Baustelle“ statt 🚧 im Text). */
const platzhalterTitel = () => document.querySelector('[data-lfh="platzhalter-titel"]');

describe('App-Routing', () => {
  it('kehrt nach Login zur vollständigen URL zurück und hält Auth beim Routenwechsel', async () => {
    let pruefungen = 0;
    server.use(
      http.get('/api/auth/me', () => {
        pruefungen += 1;
        return HttpResponse.json({ error: 'x' }, { status: 401 });
      }),
      http.post('/api/auth/login', () => HttpResponse.json(admin)),
      http.get('/api/dev/users', () => HttpResponse.json([])),
      http.get('/api/auth/providers', () => HttpResponse.json([])),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      // Der Admin darf beide Einstellungen lesen. Die Default-403 stieße sonst die
      // Benutzerprüfung an (LLH-1360), und `/me` antwortet hier immer 401.
      http.get('/api/org-settings', () =>
        HttpResponse.json({ org_id: 1, zeitzone: 'Europe/Berlin' }),
      ),
      http.get('/api/incidents/7/settings', () =>
        HttpResponse.json({
          einsatz_id: 7,
          etb_nummer_eingefroren: false,
          meldung_nummer_eingefroren: false,
          auftrag_nummer_eingefroren: false,
        }),
      ),
    );
    const ziel = '/einsaetze/7/wip-probe?ansicht=detail#lage';
    const { router } = renderApp(ziel);
    await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'test-passwort');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(platzhalterTitel()).toHaveTextContent('WIP-Probe'));
    expect(router.state.location).toMatchObject({
      pathname: '/einsaetze/7/wip-probe',
      search: '?ansicht=detail',
      hash: '#lage',
    });
    await act(async () => {
      await router.navigate('/einsaetze');
    });
    expect(await screen.findByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    expect(pruefungen).toBe(1);
  });

  it('Sitzungsende im Betrieb: Dialog über der Seite, „Abmelden“ kennt die aktuelle URL samt Query und Hash (LLH-1770)', async () => {
    server.use(
      meHandler(admin),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      http.get('/api/auth/providers', () => HttpResponse.json([])),
    );
    const { router } = renderApp('/einsaetze');
    await screen.findByRole('button', { name: 'Neuer Einsatz' });
    const ziel = '/einsaetze/7/wip-probe?ansicht=detail#lage';
    await act(async () => {
      await router.navigate(ziel);
    });
    await waitFor(() => expect(platzhalterTitel()).toHaveTextContent('WIP-Probe'));
    act(() => window.dispatchEvent(new Event(SITZUNG_ABGELAUFEN)));
    // Die Seite bleibt, darüber der Dialog.
    expect(await screen.findByRole('dialog', { name: 'Sitzung beendet' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/einsaetze/7/wip-probe');
    expect(platzhalterTitel()).toHaveTextContent('WIP-Probe');
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.state).toMatchObject({ von: ziel, grund: 'sitzung-beendet' });
  });

  it('lädt das per React.lazy eingebundene Meldebild (Kräfteübersicht) im Data Router', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
    );
    renderApp('/einsaetze/7/kraefteuebersicht');
    expect(await screen.findByRole('heading', { name: /Kräfteübersicht/ })).toBeInTheDocument();
  });

  it('leitet ohne Anmeldung zu /login um', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
    server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('Default-Route /einsaetze/:id landet im Führungsüberblick (Neuentwurf)', async () => {
    // Ab `xl` steht das Modulpanel ohne gemerkte Wahl offen (LFH-952); 1024 läge darunter.
    setzeViewportBreite(1440);
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
    );
    const { router } = renderApp('/einsaetze/7');
    await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze/7/ueberblick'));
    expect(await screen.findByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
    // Panel öffnet sich auf dem Redirect-Pfad zur Kategorie des Ziel-Moduls (Führung).
    // Auf das Panel gescopt: „Führung" steht auch als Rail-Etikett im Baum.
    await waitFor(() => {
      const panel = document.querySelector<HTMLElement>('[data-lfh="modul-panel"]');
      expect(panel).not.toBeNull();
      expect(within(panel!).getByText('Führung')).toBeInTheDocument();
    });
  });

  // i6k6mzed (design.md D8, Spec `modul-freigabe`, „Alte Adressen des Stabs führen in den
  // Einsatz“): das Modul Stab ist entfernt; seine Adressen landen im Einsatz statt in der Liste.
  it.each([
    '/einsaetze/7/stab',
    '/einsaetze/7/stab/presse',
    '/einsaetze/7/stab/presse/mitteilungen/3',
  ])('%s führt in den Einsatz', async (alt) => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
    );
    const { router } = renderApp(alt);
    await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze/7/ueberblick'));
    expect(await screen.findByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
  });

  // LFH-734: ein Tab, eine Live-Verbindung. Im Einsatz trägt der Einsatz-Strom die
  // Org-Ereignisse mit, außerhalb öffnet die Betriebszeile den Org-Strom, ohne Anmeldung keiner.
  describe('Live-Verbindung je Route (LFH-734)', () => {
    const urls: { url: string; closed: boolean }[] = [];
    class AufzeichnendeEventSource {
      eintrag: { url: string; closed: boolean };
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.eintrag = { url, closed: false };
        urls.push(this.eintrag);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {
        this.eintrag.closed = true;
      }
    }
    const offene = () => urls.filter((u) => !u.closed).map((u) => u.url);
    afterEach(() => {
      urls.length = 0;
      vi.unstubAllGlobals();
    });

    it('auf der Einsatzliste genau eine Verbindung zum Org-Strom', async () => {
      vi.stubGlobal('EventSource', AufzeichnendeEventSource);
      server.use(
        meHandler(admin),
        http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      );
      renderApp('/einsaetze');
      expect(await screen.findByText('Hochwasser Nord')).toBeInTheDocument();
      await waitFor(() => expect(offene()).toEqual(['/api/live']));
    });

    it('im Einsatz genau eine Verbindung, die zum Einsatz-Strom', async () => {
      vi.stubGlobal('EventSource', AufzeichnendeEventSource);
      server.use(
        meHandler(admin),
        http.get('/api/incidents', () => HttpResponse.json([einsatz])),
        http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      );
      renderApp('/einsaetze/7/ueberblick');
      expect(await screen.findByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
      await waitFor(() => expect(offene()).toEqual(['/api/incidents/7/live']));
      // Auch nicht kurzzeitig: beim Direktaufruf laufen die Effekte des Einsatz-Rahmens vor
      // denen der Betriebszeile, der Org-Strom darf trotzdem nie aufgehen.
      expect(urls.map((u) => u.url)).not.toContain('/api/live');
    });

    it('beim Verlassen des Einsatzes übernimmt der Org-Strom', async () => {
      vi.stubGlobal('EventSource', AufzeichnendeEventSource);
      server.use(
        meHandler(admin),
        http.get('/api/incidents', () => HttpResponse.json([einsatz])),
        http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      );
      const { router } = renderApp('/einsaetze/7/ueberblick');
      await waitFor(() => expect(offene()).toEqual(['/api/incidents/7/live']));

      await act(() => router.navigate('/einsaetze'));

      await waitFor(() => expect(offene()).toEqual(['/api/live']));
      expect(urls.find((u) => u.url === '/api/incidents/7/live')?.closed).toBe(true);
    });

    // Die Betriebszeile steht hinter `RequireAuth`: ohne Anmeldung wird sie gar nicht gerendert.
    // Die Bedingung im Hook selbst prüft `useOrgLiveStream.test.tsx`.
    it('ohne Anmeldung wird keine Verbindung geöffnet', async () => {
      vi.stubGlobal('EventSource', AufzeichnendeEventSource);
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
        http.get('/api/dev/users', () => HttpResponse.json([])),
        http.get('/api/auth/providers', () => HttpResponse.json([])),
      );
      renderApp('/');
      expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
      expect(urls).toHaveLength(0);
    });
  });

  it('zeigt auf /einsaetze genau eine globale Betriebszeile, wenn der Browser offline ist', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
    );

    renderApp('/einsaetze');

    const text = 'Offline — keine Verbindung zum Server.';
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getAllByText(text)).toHaveLength(1);
  });

  it('WIP-Modul-Route rendert den Stub', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
    );
    renderApp('/einsaetze/7/wip-probe');
    await waitFor(() => expect(platzhalterTitel()).toHaveTextContent('WIP-Probe'));
  });

  it('gefahren-Route rendert die Gefahrenmatrix statt auf die Lagekarte umzuleiten', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      http.get('/api/incidents/7/hazard-areas', () =>
        HttpResponse.json([
          { id: 1, einsatz_id: 7, label: 'Nord', zonen_ids: [], hoechste_warnstufe: 'keine' },
        ]),
      ),
      http.get('/api/incidents/7/hazard-areas/1/matrix', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7/gefahren');
    // Matrix-eigene Gefahrentyp-Zeile beweist: GefahrenPage rendert (kein Redirect, kein Stub).
    expect((await screen.findAllByText('Brand'))[0]).toBeInTheDocument();
  });

  /**
   * Unbekannte Adresse im Einsatz (LLH-1729): sie bleibt im Einsatzrahmen stehen und sagt „Seite
   * nicht gefunden“, statt still auf die Einsatzliste zu fallen. Drei Formen: unbekanntes Segment,
   * unbekannter Unterpfad eines Moduls, Registry-Schlüssel statt Route (`gefahrenzonen`).
   */
  describe('unbekannte Adresse im Einsatz (LLH-1729)', () => {
    function einsatzServer() {
      server.use(
        meHandler(admin),
        http.get('/api/incidents', () => HttpResponse.json([einsatz])),
        http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      );
    }

    it.each(['/einsaetze/7/gibtsnicht', '/einsaetze/7/etb/quatsch', '/einsaetze/7/gefahrenzonen'])(
      '%s bleibt im Einsatz und sagt „Seite nicht gefunden“',
      async (pfad) => {
        einsatzServer();
        const { router } = renderApp(pfad);
        expect(
          await screen.findByRole('heading', { level: 1, name: 'Seite nicht gefunden' }),
        ).toBeInTheDocument();
        // Die Adresse steht da, damit sich ein Tippfehler erkennen lässt, und bleibt in der Leiste.
        expect(screen.getByText(pfad)).toBeInTheDocument();
        expect(router.state.location.pathname).toBe(pfad);
        // Der Einsatzrahmen steht: der Name des Einsatzes im Kopf.
        expect((await screen.findAllByText('Hochwasser Nord')).length).toBeGreaterThan(0);
      },
    );

    it('der Rückweg führt in den Überblick', async () => {
      einsatzServer();
      const { router } = renderApp('/einsaetze/7/gibtsnicht');
      await userEvent.click(await screen.findByRole('button', { name: 'Überblick öffnen' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze/7/ueberblick'));
    });

    it('ist der Überblick gesperrt, führt der Rückweg ins erste freie Modul', async () => {
      einsatzServer();
      server.use(
        http.get('/api/incidents/7/module-access', () =>
          HttpResponse.json(freigabenFixture({ ueberblick: { zugriff: false } })),
        ),
      );
      // Das Ziel aus derselben Auflösung wie der Modulwächter, ohne Standardmodul: Beschriftung
      // UND Ziel müssen ihm folgen, sonst führte ein richtig beschrifteter Knopf in die Sperre.
      const ziel = freiesRueckwegModul(freigabenFixture({ ueberblick: { zugriff: false } }));
      expect(ziel.key).not.toBe('ueberblick');
      const { router } = renderApp('/einsaetze/7/gibtsnicht');
      await userEvent.click(await screen.findByRole('button', { name: `${ziel.label} öffnen` }));
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/einsaetze/7/${modulZielRoute(ziel)}`),
      );
    });

    it('merkt die unbekannte Adresse nicht als letzten Ort, die nächste gültige schon', async () => {
      einsatzServer();
      const { router } = renderApp('/einsaetze/7/gibtsnicht');
      await screen.findByRole('heading', { level: 1, name: 'Seite nicht gefunden' });
      // Freigaben angekommen: der Knopf steht erst danach, also hätte der Rahmen jetzt gemerkt.
      await screen.findByRole('button', { name: 'Überblick öffnen' });
      expect(leseLetztenOrt(admin.id)).toBeNull();
      await act(async () => {
        await router.navigate('/einsaetze/7/ueberblick');
      });
      await waitFor(() =>
        expect(leseLetztenOrt(admin.id)).toEqual({ einsatzId: 7, pfad: '/einsaetze/7/ueberblick' }),
      );
    });
  });

  /**
   * Profil-Rückweg (LLH-1827, Spec `seiten-zustaende`, „Ein Muster für ein Objekt, das es nicht
   * gibt“, Szenario „Profil-Rückweg“): eine Detailseite, deren Objekt es nicht (mehr) gibt, wird
   * nicht als letzter Ort gemerkt. „Zurück zu …“ aus dem Profil führt an die Stelle davor.
   */
  describe('Profil-Rückweg nach einem Objekt, das es nicht gibt (LLH-1827)', () => {
    it('führt nicht auf die Adresse einer unbekannten Person', async () => {
      server.use(
        meHandler(admin),
        http.get('/api/incidents', () => HttpResponse.json([einsatz])),
        http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
        http.get('/api/incidents/7/persons/999999', () =>
          HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
        ),
      );
      const { router } = renderApp('/einsaetze/7/ueberblick');
      await waitFor(() =>
        expect(leseLetztenOrt(admin.id)).toEqual({ einsatzId: 7, pfad: '/einsaetze/7/ueberblick' }),
      );

      await act(async () => {
        await router.navigate('/einsaetze/7/personen/999999');
      });
      expect(await screen.findByText('Diese Person gibt es nicht (mehr)')).toBeInTheDocument();
      // Im Rahmen: der Name des Einsatzes steht im Kopf, die Adresse bleibt in der Leiste.
      expect((await screen.findAllByText('Hochwasser Nord')).length).toBeGreaterThan(0);
      expect(router.state.location.pathname).toBe('/einsaetze/7/personen/999999');
      expect(screen.getByRole('button', { name: 'Zu den Betroffenen' })).toBeInTheDocument();
      expect(leseLetztenOrt(admin.id)).toEqual({ einsatzId: 7, pfad: '/einsaetze/7/ueberblick' });

      await act(async () => {
        await router.navigate('/profil');
      });
      const zurueck = await screen.findByRole('link', { name: 'Zurück zu Hochwasser Nord' });
      expect(zurueck).toHaveAttribute('href', '/einsaetze/7/ueberblick');
      await userEvent.click(zurueck);
      await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze/7/ueberblick'));
    });

    it('stellt den Ort davor unverändert wieder her, ohne seine Frist zu verlängern', async () => {
      server.use(
        meHandler(admin),
        http.get('/api/incidents', () => HttpResponse.json([einsatz])),
        http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
        http.get('/api/incidents/7/persons/999999', () =>
          HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
        ),
      );
      // Ein Ort aus einer früheren Sitzung, fast eine Schicht alt.
      const vorher = JSON.stringify({
        einsatzId: 7,
        pfad: '/einsaetze/7/etb',
        at: Date.now() - 11.5 * 60 * 60 * 1000,
      });
      localStorage.setItem(`lfh:nav:letzter-ort:${admin.id}`, vorher);
      renderApp('/einsaetze/7/personen/999999');
      expect(await screen.findByText('Diese Person gibt es nicht (mehr)')).toBeInTheDocument();
      await waitFor(() =>
        expect(localStorage.getItem(`lfh:nav:letzter-ort:${admin.id}`)).toBe(vorher),
      );
    });
  });

  /**
   * Der BARE Einstellungs-Pfad (Ziel jedes Klicks aus der Modul-Navigation) landet auf der
   * ersten Sektion. Layout-Test und e2e springen direkt auf eine Sektion und sähen den Bruch nicht.
   */
  function einstellungenServer() {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      http.get('/api/incidents/7/settings', () =>
        HttpResponse.json({
          einsatz_id: 7,
          etb_nummer_eingefroren: false,
          meldung_nummer_eingefroren: false,
          auftrag_nummer_eingefroren: false,
        }),
      ),
    );
  }

  it('barer Einstellungs-Pfad landet auf der ersten Sektion', async () => {
    einstellungenServer();
    renderApp('/einsaetze/7/einstellungen');
    // Ein sektionseigenes Feld beweist, dass NICHT nur das Reiterband gerendert hat.
    expect(await screen.findByLabelText('Einstiegsmodul')).toBeInTheDocument();
  });

  it('ein unbekanntes Einstellungs-Segment landet ebenfalls dort', async () => {
    einstellungenServer();
    renderApp('/einsaetze/7/einstellungen/quatsch');
    expect(await screen.findByLabelText('Einstiegsmodul')).toBeInTheDocument();
  });

  // Gegenaussage: die Umleitung ist keine Zwangsumleitung — eine benannte Sektion kommt an.
  it('eine benannte Sektion wird NICHT auf die erste umgeleitet', async () => {
    einstellungenServer();
    renderApp('/einsaetze/7/einstellungen/aufbewahrung');
    expect(await screen.findByLabelText('Aufbewahrungs-Dauer (Tage)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Einstiegsmodul')).toBeNull();
  });

  it('betreuung-Route rendert die BetreuungPage statt Stub (LFH-639)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      http.get('/api/incidents/7/care', () => HttpResponse.json({ stellen: [] })),
    );
    renderApp('/einsaetze/7/betreuung');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Betreuung' })).toBeInTheDocument(),
    );
    expect(platzhalterTitel()).toBeNull();
  });

  it('evakuierung-Route rendert die EvakuierungPage statt Stub (LLH-1034)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      http.get('/api/incidents/7/evacuation', () => HttpResponse.json({ bezirke: [] })),
    );
    renderApp('/einsaetze/7/evakuierung');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Evakuierung' })).toBeInTheDocument(),
    );
    expect(platzhalterTitel()).toBeNull();
  });

  it('verpflegung-Route rendert die VerpflegungPage statt Stub (LFH-634)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      http.get('/api/incidents/7/catering', () =>
        HttpResponse.json({
          zeitfenster: [],
          stellen: [],
          empfaenger: { einheiten: [], abschnitte: [] },
        }),
      ),
    );
    renderApp('/einsaetze/7/verpflegung');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Verpflegung' })).toBeInTheDocument(),
    );
    // Der Stub trägt denselben Titel — unterschieden wird am Platzhalter selbst.
    expect(platzhalterTitel()).toBeNull();
    expect(screen.queryByText('Noch nicht verfügbar.')).not.toBeInTheDocument();
  });

  it('fahrzeuge-Route rendert die echte FahrzeugePage statt Stub', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/incidents', () => HttpResponse.json([einsatz])),
      http.get('/api/incidents/7', () => HttpResponse.json(einsatz)),
      http.get('/api/incidents/7/vehicles', () => HttpResponse.json([])),
      http.get('/api/vehicle-statuses', () => HttpResponse.json([])),
      http.get('/api/vehicles', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7/fahrzeuge');
    // Teilstring: der Einsatz-Status-Tag steht innerhalb der Überschrift („Fahrzeuge aktiv").
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Fahrzeuge/ })).toBeInTheDocument(),
    );
    expect(platzhalterTitel()).toBeNull();
  });
});
