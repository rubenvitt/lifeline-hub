import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import AdminLayout from './AdminLayout';
import { adminBenutzerPfad, defaultAdminPfad, ersteSektionPfad } from './adminNav';

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

/** Zeigt den aktuellen Pfad — Landepunkt der Sektions-/Redirect-Routen. */
function Pfad() {
  return <div>PFAD:{useLocation().pathname}</div>;
}

/** Routen-Baum wie in App.tsx (registry-getriebene Redirects + generischer Sektions-Stub). */
function setup(me: Record<string, unknown>, route = defaultAdminPfad()) {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(me)));
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/benutzer" element={<Navigate to={adminBenutzerPfad()} replace />} />
        <Route path="/stammdaten" element={<Navigate to="/admin/stammdaten" replace />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to={defaultAdminPfad()} replace />} />
          <Route path="stammdaten" element={<Navigate to={ersteSektionPfad('stammdaten')} replace />} />
          <Route path="einstellungen" element={<Navigate to={ersteSektionPfad('einstellungen')} replace />} />
          <Route path="karten" element={<Navigate to={ersteSektionPfad('karten')} replace />} />
          <Route path=":gruppe/:sektion" element={<Pfad />} />
          <Route path="benutzer" element={<Pfad />} />
        </Route>
        <Route path="/einsaetze" element={<div>Einsätze</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('AdminLayout — Sidebar', () => {
  it('Fuehrungskraft: Gruppen + Sektions-Einträge sichtbar, KEIN Benutzer-Eintrag', async () => {
    setup(fuehrungskraft);
    expect(await screen.findByText('Stammdaten')).toBeInTheDocument();
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
    expect(screen.getByText('Karten')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Fahrzeuge' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Online-Quellen' })).toBeInTheDocument();
    // Benutzer nur für System-Admins.
    expect(screen.queryByRole('menuitem', { name: 'Benutzer' })).not.toBeInTheDocument();
  });

  it('Admin: Benutzer-Eintrag zusätzlich sichtbar', async () => {
    setup(admin);
    expect(await screen.findByRole('menuitem', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Anzeige' })).toBeInTheDocument();
  });

  it('Nicht-Berechtigter: Redirect zu /einsaetze, keine Sidebar', async () => {
    setup(sonstiger);
    await waitFor(() => expect(screen.getByText('Einsätze')).toBeInTheDocument());
    expect(screen.queryByRole('menuitem', { name: 'Fahrzeuge' })).not.toBeInTheDocument();
  });

  it('aktive Sektion folgt der URL (/admin/karten/offline → „Offline-Karten" selektiert)', async () => {
    setup(fuehrungskraft, '/admin/karten/offline');
    await screen.findByText('PFAD:/admin/karten/offline');
    expect(screen.getByRole('menuitem', { name: 'Offline-Karten' })).toHaveClass(
      'ant-menu-item-selected',
    );
    expect(screen.getByRole('menuitem', { name: 'Fahrzeuge' })).not.toHaveClass(
      'ant-menu-item-selected',
    );
  });

  it('Klick auf einen Eintrag navigiert zur Sektions-Route', async () => {
    setup(fuehrungskraft);
    await screen.findByText('Stammdaten');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fahrzeuge' }));
    expect(await screen.findByText('PFAD:/admin/stammdaten/fahrzeuge')).toBeInTheDocument();
  });

  it('Default- und Bestands-Redirects landen richtig', async () => {
    setup(fuehrungskraft, '/admin');
    expect(await screen.findByText('PFAD:/admin/stammdaten/stichworte')).toBeInTheDocument();
  });

  it('/stammdaten leitet auf die erste Stammdaten-Sektion', async () => {
    setup(fuehrungskraft, '/stammdaten');
    expect(await screen.findByText('PFAD:/admin/stammdaten/stichworte')).toBeInTheDocument();
  });

  it('/benutzer leitet auf /admin/benutzer', async () => {
    setup(admin, '/benutzer');
    expect(await screen.findByText('PFAD:/admin/benutzer')).toBeInTheDocument();
  });
});
