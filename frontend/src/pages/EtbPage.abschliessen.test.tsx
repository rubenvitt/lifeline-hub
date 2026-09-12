import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EtbPage from './EtbPage';

// Normaler Benutzer (kein System-Admin): die Rollen-Tests prüfen die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1,
  anzeigename: 'Nutzer',
  benutzername: 'nutzer',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};
function einsatz(status: string) {
  return {
    id: 7,
    bezeichnung: 'Hochwasser',
    stichwort: null,
    status,
    begonnen_at: '2026-05-23 09:00:00',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    meine_rolle: 'einsatzleitung',
  };
}

describe('EtbPage – Abschließen', () => {
  it('schließt einen aktiven Einsatz als Einsatzleitung ab', async () => {
    let abgeschlossen = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json(einsatz(abgeschlossen ? 'abgeschlossen' : 'aktiv')),
      ),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
      http.post('/api/einsaetze/7/abschliessen', () => {
        abgeschlossen = true;
        return HttpResponse.json(einsatz('abgeschlossen'));
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/etb' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einsatz abschließen' }));
    // Popconfirm bestätigen
    await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(screen.getByText('abgeschlossen')).toBeInTheDocument());
  });

  it('zeigt den Abschließen-Button nicht für Nicht-Einsatzleitung', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz('aktiv'), meine_rolle: 'fuehrungspersonal' }),
      ),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/etb' },
    );
    await screen.findByRole('heading', { name: 'Hochwasser' });
    expect(screen.queryByRole('button', { name: 'Einsatz abschließen' })).not.toBeInTheDocument();
  });

  it('zeigt Beobachtern keine Schreib-/Verwaltungsaktionen (read-only)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz('aktiv'), meine_rolle: 'beobachter' }),
      ),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/etb' },
    );
    await screen.findByRole('heading', { name: 'Hochwasser' });
    expect(screen.queryByRole('button', { name: 'Erfassen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Einsatz abschließen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mitglieder' })).not.toBeInTheDocument();
  });
});
