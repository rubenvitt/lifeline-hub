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
import { server } from './test/server';
import { SITZUNG_ABGELAUFEN } from './auth/sitzungsEvent';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
  abgeschlossen_von: null, meine_rolle: 'einsatzleitung',
};

afterEach(() => vi.restoreAllMocks());

function renderApp(route: string) {
  const client = neuerQueryClient();
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  return { router, ...render(
    <QueryClientProvider client={client}>
      <ConfigProvider>
        <AntApp><RouterProvider router={router} /></AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  ) };
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
    const ziel = '/einsaetze/7/stab?ansicht=detail#lage';
    const { router } = renderApp(ziel);
    await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'test-passwort');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await screen.findByText(/🚧 Stab/);
    expect(router.state.location).toMatchObject({
      pathname: '/einsaetze/7/stab', search: '?ansicht=detail', hash: '#lage',
    });
    await act(async () => { await router.navigate('/einsaetze'); });
    expect(await screen.findByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    expect(pruefungen).toBe(1);
  });

  it('die Sitzungswache kennt nach Navigation die aktuelle URL einschließlich Query und Hash', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    const { router } = renderApp('/einsaetze');
    await screen.findByRole('button', { name: 'Neuer Einsatz' });
    const ziel = '/einsaetze/7/stab?ansicht=detail#lage';
    await act(async () => { await router.navigate(ziel); });
    await screen.findByText(/🚧 Stab/);
    act(() => window.dispatchEvent(new Event(SITZUNG_ABGELAUFEN)));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.state).toMatchObject({ von: ziel });
  });

  it('lädt die per React.lazy eingebundene Kräfteübersicht im Data Router', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
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

  it('Default-Route /einsaetze/:id landet im Lage-Dashboard', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    renderApp('/einsaetze/7');
    // Das Dashboard trägt die Bezeichnung seit LFH-352 im Instrumentenband, nicht
    // mehr als Seitenüberschrift — die Überschriften-Ebene gehört jetzt den
    // Kachelköpfen. Geprüft wird deshalb das Band selbst.
    await waitFor(() =>
      expect(
        screen.getAllByText('Hochwasser Nord').some((e) => e.classList.contains('lfh-band__titel')),
      ).toBe(true),
    );
    // Panel öffnet sich auf dem Redirect-Pfad zur Kategorie des Ziel-Moduls (Lage).
    //
    // AUF DAS PANEL GESCOPT (LFH-337 · Fix-Welle): seit die Kategorie-Rail ihre Etiketten
    // als sichtbaren Text trägt statt nur im `aria-label`, steht „Lage" zweimal im Baum —
    // einmal als Rail-Knopf, einmal als Panel-Überschrift. Eine ungescopte Abfrage bricht
    // daran mit „Found multiple elements". Der Anker ist das Datenmerkmal des Panels
    // (`ModulPanel.tsx:240`), nicht die Rail: geprüft werden soll, dass das PANEL auf der
    // Lage-Kategorie steht — eine Rail-gescopte Abfrage sagte nur, dass es den Knopf gibt,
    // und wäre auf jeder beliebigen Route grün. Gleiche Bauform wie
    // `einsatz/EinsatzLayout.test.tsx:566-570`.
    await waitFor(() => {
      const panel = document.querySelector<HTMLElement>('[data-lfh="modul-panel"]');
      expect(panel).not.toBeNull();
      expect(within(panel!).getByText('Lage')).toBeInTheDocument();
    });
  });

  it('zeigt auf /einsaetze genau eine globale Betriebszeile, wenn der Browser offline ist', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    );

    renderApp('/einsaetze');

    const text = 'Offline — keine Verbindung zum Server.';
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getAllByText(text)).toHaveLength(1);
  });

  it('WIP-Modul-Route rendert den Stub', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    renderApp('/einsaetze/7/stab');
    await waitFor(() => expect(screen.getByText(/🚧 Stab/)).toBeInTheDocument());
  });

  it('gefahren-Route rendert die Gefahrenmatrix statt auf die Lagekarte umzuleiten', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/gefahrengebiete', () => HttpResponse.json([{ id: 1, einsatz_id: 7, label: 'Nord', zonen_ids: [], hoechste_warnstufe: 'keine' }])),
      http.get('/api/einsaetze/7/gefahrengebiete/1/matrix', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7/gefahren');
    // Matrix-eigene Gefahrentyp-Zeile beweist: GefahrenPage rendert (kein Redirect, kein Stub).
    expect((await screen.findAllByText('Brand'))[0]).toBeInTheDocument();
  });

  /**
   * Der BARE Einstellungs-Pfad landet auf der ersten Sektion (LFH-345 · C10, H15/M15).
   *
   * Genau diesen Pfad baut `modulZielRoute` und damit jeder Klick aus der Modul-Navigation —
   * nach der Zerlegung in vier Sektionen trägt ihn keine Sektionsroute mehr, sondern eine
   * Index-Umleitung. Bricht sie, steht ein Reiterband über weißer Fläche: der Layout-Test
   * montiert die Sektionen selbst und der e2e-Spec springt direkt auf `…/module`, keiner von
   * beiden käme hier vorbei.
   */
  function einstellungenServer() {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/einstellungen', () =>
        HttpResponse.json({ einsatz_id: 7, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false }),
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

  it('fahrzeuge-Route rendert die echte FahrzeugePage statt Stub', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/fahrzeug-status', () => HttpResponse.json([])),
      http.get('/api/fahrzeuge', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7/fahrzeuge');
    // Teilstring statt exaktem Namen: seit die Seite ihren Kopf über `EinsatzSeite` baut,
    // steht der Einsatz-Status-Tag INNERHALB der Überschrift (Muster aus `BrDetailPage`),
    // und der zugängliche Name lautet damit „Fahrzeuge aktiv". Was der Test belegen soll —
    // die echte Seite statt des Platzhalters — trägt die 🚧-Zusicherung darunter.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Fahrzeuge/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/🚧/)).not.toBeInTheDocument();
  });
});
