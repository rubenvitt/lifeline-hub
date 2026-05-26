import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import AppLayout from './AppLayout';

const admin = {
  id: 1, anzeigename: 'Chef', benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

function setup(me: Record<string, unknown>) {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(me)));
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div>Inhalt</div>} />
        </Route>
      </Routes>
    </AuthProvider>,
  );
}

describe('AppLayout (globale Topbar)', () => {
  it('Admin: Stammdaten und Benutzer sind Links, Profil/Abmelden im Benutzermenü', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Stammdaten' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    // Profil und Abmelden liegen jetzt im Benutzermenü (Dropdown).
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Abmelden')).toBeInTheDocument();
  });

  it('Fuehrungskraft: Stammdaten frei, Benutzer gesperrt (🔒, kein Link)', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'Eva' });
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Stammdaten' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Benutzer' })).not.toBeInTheDocument();
    expect(screen.getByText('Benutzer 🔒')).toBeInTheDocument();
  });

  it('Sonstige: Stammdaten und Benutzer gesperrt, kein Admin-Tag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'keine', anzeigename: 'Max' });
    await waitFor(() => expect(screen.getByText('Max')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Stammdaten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Benutzer' })).not.toBeInTheDocument();
    expect(screen.getByText('Stammdaten 🔒')).toBeInTheDocument();
    expect(screen.getByText('Benutzer 🔒')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
