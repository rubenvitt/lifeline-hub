import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from './test/utils';
import { AuthProvider } from './auth/AuthContext';
import { CommandPaletteProvider } from './command-palette/CommandPaletteProvider';
import App from './App';
import { http, HttpResponse } from 'msw';
import { server } from './test/server';

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
  return renderMitProviders(
    <AuthProvider>
      <CommandPaletteProvider>
        <App />
      </CommandPaletteProvider>
    </AuthProvider>,
    { route },
  );
}

describe('App-Routing', () => {
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
    expect(await screen.findByText('Lage')).toBeInTheDocument();
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
