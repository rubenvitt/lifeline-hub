import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Navigate, Route, Routes, useLocation } from 'react-router';
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
          {/* Die A7-Detailrouten NAMENTLICH wie in `App.tsx` — ein generisches
              `:gruppe/:sektion/:id` machte im Test Adressen auflösbar, die es in der
              Anwendung nicht gibt (z. B. `/admin/karten/online/7`). */}
          <Route path="stammdaten/fahrzeuge/:fahrzeugId" element={<Pfad />} />
          <Route path="stammdaten/personal/:personalId" element={<Pfad />} />
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

  /**
   * Review-Befund zu LFH-346 · C11: die Menü-Keys sind zweisegmentig, die Detailrouten aus A7
   * dreisegmentig — mit exaktem Vergleich war auf einer Detailseite KEIN Eintrag markiert, die
   * Sidebar sah aus wie verlassen. Geprüft wird die Markierung UND ihre Eindeutigkeit: genau
   * ein selektierter Eintrag schlägt zugleich ein zu gieriges Präfix.
   */
  it.each([
    ['/admin/stammdaten/fahrzeuge/7', 'Fahrzeuge'],
    ['/admin/stammdaten/personal/5', 'Personal'],
  ])('Detailroute %s markiert weiterhin „%s"', async (pfad, eintrag) => {
    setup(fuehrungskraft, pfad);
    await screen.findByText(`PFAD:${pfad}`);
    expect(screen.getByRole('menuitem', { name: eintrag })).toHaveClass('ant-menu-item-selected');
    expect(document.querySelectorAll('.ant-menu-item-selected')).toHaveLength(1);
  });

  it('die Sektionsroute selbst bleibt markiert (Gegenaussage zum Präfix-Match)', async () => {
    setup(fuehrungskraft, '/admin/stammdaten/fahrzeuge');
    await screen.findByText('PFAD:/admin/stammdaten/fahrzeuge');
    expect(screen.getByRole('menuitem', { name: 'Fahrzeuge' })).toHaveClass(
      'ant-menu-item-selected',
    );
    expect(document.querySelectorAll('.ant-menu-item-selected')).toHaveLength(1);
  });

  /**
   * `stammdaten/personal` ist echtes Präfix von `stammdaten/personal-status` — das einzige
   * solche Paar im Bestand. Stünde hier „Personal" markiert, landete der Rückklick auf der
   * falschen Liste.
   *
   * Was dieser Test GENAU pinnt, ist gemessen und nicht behauptet: der Präfix-Match hat zwei
   * Riegel (Trenner `/` und längster Treffer), und auf den heute erreichbaren Routen genügt
   * JEDER von beiden allein. Einzeln zurückgedreht bleibt der Test deshalb grün (beide Proben
   * gefahren); rot wird er, sobald BEIDE fallen — er belegt also „mindestens ein Riegel
   * greift", nicht die Wahl des Tie-Breaks. Ein Gegenbeleg für die einzelne Hälfte bräuchte
   * einen dreisegmentigen Menü-Key, den es (noch) nicht gibt.
   */
  it('Präfix-gleiche Keys: Personal-Status markiert, Personal nicht', async () => {
    setup(fuehrungskraft, '/admin/stammdaten/personal-status');
    await screen.findByText('PFAD:/admin/stammdaten/personal-status');
    expect(screen.getByRole('menuitem', { name: 'Personal-Status' })).toHaveClass(
      'ant-menu-item-selected',
    );
    expect(screen.getByRole('menuitem', { name: 'Personal' })).not.toHaveClass(
      'ant-menu-item-selected',
    );
  });
});
