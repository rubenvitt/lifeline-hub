import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
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
  it('Admin: Verwaltung ist Link, Profil/Abmelden im Benutzermenü (Benutzer wohnt in der Sidebar)', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    // Benutzer ist kein Topbar-Link mehr (steht in der Admin-Sidebar).
    expect(screen.queryByRole('link', { name: 'Benutzer' })).not.toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    // Profil und Abmelden liegen jetzt im Benutzermenü (Dropdown).
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Abmelden')).toBeInTheDocument();
  });

  it('Fuehrungskraft: Verwaltung frei, kein Benutzer-Topbar-Eintrag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'Eva' });
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    expect(screen.queryByText('Benutzer 🔒')).not.toBeInTheDocument();
  });

  it('Sonstige: Verwaltung gesperrt (🔒), kein Admin-Tag, kein Benutzer-Eintrag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'keine', anzeigename: 'Max' });
    await waitFor(() => expect(screen.getByText('Max')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Verwaltung' })).not.toBeInTheDocument();
    expect(screen.getByText('Verwaltung 🔒')).toBeInTheDocument();
    expect(screen.queryByText('Benutzer 🔒')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
