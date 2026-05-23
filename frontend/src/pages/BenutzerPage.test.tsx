import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import BenutzerPage from './BenutzerPage';

function benutzer(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
    org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', ...over,
  };
}

describe('BenutzerPage', () => {
  it('listet Benutzer', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/benutzer' },
    );
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
  });

  it('legt einen neuen Benutzer an', async () => {
    let angelegt = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json(angelegt ? [benutzer(), benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' })] : [benutzer()]),
      ),
      http.post('/api/benutzer', () => {
        angelegt = true;
        return HttpResponse.json(benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva' }), {
          status: 201,
        });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/benutzer' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'eva');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
  });

  it('leitet Nicht-Admins weg von der Benutzerverwaltung', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...benutzer(), system_rolle: 'keiner' }),
      ),
      http.get('/api/benutzer', () => HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/benutzer' },
    );
    expect(await screen.findByText('Einsatz-Liste')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Benutzer anlegen' })).not.toBeInTheDocument();
  });
});
