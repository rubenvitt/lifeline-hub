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
import { adminFixture } from './test/fixtures';

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
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    const ziel = '/einsaetze/7/wip-probe?ansicht=detail#lage';
    const { router } = renderApp(ziel);
    await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'test-passwort');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await screen.findByText(/🚧 WIP-Probe/);
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

  it('die Sitzungswache kennt nach Navigation die aktuelle URL einschließlich Query und Hash', async () => {
    server.use(
      meHandler(admin),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    const { router } = renderApp('/einsaetze');
    await screen.findByRole('button', { name: 'Neuer Einsatz' });
    const ziel = '/einsaetze/7/wip-probe?ansicht=detail#lage';
    await act(async () => {
      await router.navigate(ziel);
    });
    await screen.findByText(/🚧 WIP-Probe/);
    act(() => window.dispatchEvent(new Event(SITZUNG_ABGELAUFEN)));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.state).toMatchObject({ von: ziel });
  });

  it('lädt das per React.lazy eingebundene Meldebild (Kräfteübersicht) im Data Router', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    renderApp('/einsaetze/7/kraefteuebersicht');
    expect(await screen.findByRole('heading', { name: /Meldebild/ })).toBeInTheDocument();
  });

  it('leitet ohne Anmeldung zu /login um', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
    server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('Default-Route /einsaetze/:id landet im Führungsüberblick (Neuentwurf)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
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

  it('zeigt auf /einsaetze genau eine globale Betriebszeile, wenn der Browser offline ist', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    );

    renderApp('/einsaetze');

    const text = 'Offline — keine Verbindung zum Server.';
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getAllByText(text)).toHaveLength(1);
  });

  it('WIP-Modul-Route rendert den Stub', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    renderApp('/einsaetze/7/wip-probe');
    await waitFor(() => expect(screen.getByText(/🚧 WIP-Probe/)).toBeInTheDocument());
  });

  it('gefahren-Route rendert die Gefahrenmatrix statt auf die Lagekarte umzuleiten', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/gefahrengebiete', () =>
        HttpResponse.json([
          { id: 1, einsatz_id: 7, label: 'Nord', zonen_ids: [], hoechste_warnstufe: 'keine' },
        ]),
      ),
      http.get('/api/einsaetze/7/gefahrengebiete/1/matrix', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7/gefahren');
    // Matrix-eigene Gefahrentyp-Zeile beweist: GefahrenPage rendert (kein Redirect, kein Stub).
    expect((await screen.findAllByText('Brand'))[0]).toBeInTheDocument();
  });

  /**
   * Der BARE Einstellungs-Pfad (Ziel jedes Klicks aus der Modul-Navigation) landet auf der
   * ersten Sektion. Layout-Test und e2e springen direkt auf eine Sektion und sähen den Bruch nicht.
   */
  function einstellungenServer() {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/einstellungen', () =>
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
    expect(await screen.findByLabelText('Standard-Modul (Einstieg)')).toBeInTheDocument();
  });

  it('ein unbekanntes Einstellungs-Segment landet ebenfalls dort', async () => {
    einstellungenServer();
    renderApp('/einsaetze/7/einstellungen/quatsch');
    expect(await screen.findByLabelText('Standard-Modul (Einstieg)')).toBeInTheDocument();
  });

  // Gegenaussage: die Umleitung ist keine Zwangsumleitung — eine benannte Sektion kommt an.
  it('eine benannte Sektion wird NICHT auf die erste umgeleitet', async () => {
    einstellungenServer();
    renderApp('/einsaetze/7/einstellungen/aufbewahrung');
    expect(await screen.findByLabelText('Aufbewahrungs-Dauer (Tage)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Standard-Modul (Einstieg)')).toBeNull();
  });

  it('betreuung-Route rendert die BetreuungPage statt Stub (LFH-639)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/betreuung', () => HttpResponse.json({ bezirke: [], stellen: [] })),
    );
    renderApp('/einsaetze/7/betreuung');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Betreuung' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/🚧/)).not.toBeInTheDocument();
  });

  it('verpflegung-Route rendert die VerpflegungPage statt Stub (LFH-634)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/verpflegung', () => HttpResponse.json({ zeitfenster: [] })),
    );
    renderApp('/einsaetze/7/verpflegung');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Verpflegung' })).toBeInTheDocument(),
    );
    // Der Stub trägt denselben Titel — unterschieden wird am Platzhalter selbst.
    expect(screen.queryByText(/🚧/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dieser Bereich ist geplant/)).not.toBeInTheDocument();
  });

  it('fahrzeuge-Route rendert die echte FahrzeugePage statt Stub', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/fahrzeug-status', () => HttpResponse.json([])),
      http.get('/api/fahrzeuge', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7/fahrzeuge');
    // Teilstring: der Einsatz-Status-Tag steht innerhalb der Überschrift („Fahrzeuge aktiv").
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Fahrzeuge/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/🚧/)).not.toBeInTheDocument();
  });
});
