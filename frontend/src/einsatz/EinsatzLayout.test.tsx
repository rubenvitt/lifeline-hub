import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinsatzLayout from './EinsatzLayout';

const admin = {
  id: 1, anzeigename: 'Chef', benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
  abgeschlossen_von: null, meine_rolle: 'einsatzleitung',
};

function setup() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route path="etb" element={<div>ETB-Inhalt</div>} />
        </Route>
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/etb' },
  );
}

function setupRoute(route: string, childPath: string) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route path={childPath} element={<div>Outlet-Inhalt</div>} />
        </Route>
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('EinsatzLayout', () => {
  it('zeigt Switcher mit Einsatznamen, Kategorie-Rail und Outlet-Inhalt', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument();
  });

  it('hält das aktive Modul auf einer Sub-Route hervorgehoben (Panel bleibt offen)', async () => {
    // Letztes Segment ist „liste"; das aktive Modul wird am Segment nach der
    // Einsatz-ID erkannt — sonst klappt das Erfassung-Panel beim UHS-Redirect zu.
    setupRoute('/einsaetze/7/unfallhilfsstellen/liste', 'unfallhilfsstellen/liste');
    expect(await screen.findByRole('button', { name: 'Unfallhilfsstellen' })).toBeInTheDocument();
  });

  it('öffnet genau EINE SSE-Verbindung für den Einsatz (Stream im Layout, LFH-97)', async () => {
    // Der Live-Stream ist hier gehoistet; das Layout ist immer gemountet → genau eine
    // Verbindung pro Einsatz, unabhängig von der offenen Modul-Seite (HTTP/1.1-6-Limit).
    const urls: string[] = [];
    class FakeEventSource {
      constructor(url: string) { urls.push(url); }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('/api/einsaetze/7/etb/stream');
  });
});

afterEach(() => vi.unstubAllGlobals());
