import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Navigate, Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import AdminLayout from './AdminLayout';

const fuehrungskraft = {
  id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

const admin = {
  id: 1, anzeigename: 'Chef', benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

const sonstiger = {
  id: 3, anzeigename: 'Max', benutzername: 'max', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

function setup(me: Record<string, unknown>, route = '/admin') {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(me)));
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/stammdaten" replace />} />
          <Route path="stammdaten" element={<div>SD-Inhalt</div>} />
          <Route path="einstellungen" element={<div>Einst-Inhalt</div>} />
        </Route>
        <Route path="/stammdaten" element={<Navigate to="/admin/stammdaten" replace />} />
        <Route path="/einsaetze" element={<div>Einsätze</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('AdminLayout', () => {
  it('Fuehrungskraft: Sub-Nav „Stammdaten" und „Einstellungen" sichtbar', async () => {
    setup(fuehrungskraft);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Stammdaten' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: 'Einstellungen' })).toBeInTheDocument();
  });

  it('Admin: Sub-Nav ebenfalls sichtbar', async () => {
    setup(admin);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Stammdaten' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: 'Einstellungen' })).toBeInTheDocument();
  });

  it('Nicht-Berechtigter: Redirect zu /einsaetze, kein Sub-Nav', async () => {
    setup(sonstiger);
    await waitFor(() => expect(screen.getByText('Einsätze')).toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'Stammdaten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Einstellungen' })).not.toBeInTheDocument();
  });

  it('/stammdaten leitet zu /admin/stammdaten weiter (kein toter Link)', async () => {
    setup(fuehrungskraft, '/stammdaten');
    await waitFor(() => expect(screen.getByText('SD-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Stammdaten' })).toBeInTheDocument();
  });
});
