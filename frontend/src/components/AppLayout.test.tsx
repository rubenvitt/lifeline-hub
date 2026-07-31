import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
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
    // Am `title` greifen, nicht am Zeichen: das Schloss ist seit LFH-370 eine Ikone in
    // einer aria-hidden-Hülle, `queryByText('Benutzer 🔒')` wäre eine Attrappe, die
    // IMMER null liefert und nichts mehr prüft.
    expect(screen.queryByTitle('Keine Berechtigung')).not.toBeInTheDocument();
  });

  it('Sonstige: Verwaltung gesperrt, kein Admin-Tag, kein Benutzer-Eintrag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'keine', anzeigename: 'Max' });
    await waitFor(() => expect(screen.getByText('Max')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Verwaltung' })).not.toBeInTheDocument();
    const gesperrt = screen.getAllByTitle('Keine Berechtigung');
    // GENAU einer — sonst bliebe „kein Benutzer-Eintrag" unbewiesen.
    expect(gesperrt).toHaveLength(1);
    expect(gesperrt[0]).toHaveTextContent('Verwaltung');
    // Die Ikone ist Dekoration und darf kein eigenes Vorleseziel sein.
    expect(within(gesperrt[0]).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  /**
   * Die Gegenprobe zum Schmal-Block darunter — und zwar mit DERSELBEN Abfrage.
   * Ohne sie wäre die Null unten auch dann grün, wenn die Beschriftung falsch
   * geschrieben oder die Rolle eine andere wäre.
   */
  it('ab lg stehen beide Umschalter in der Kopfzeile', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('radiogroup', { name: 'Farbschema wählen' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Bediendichte wählen' })).toBeInTheDocument();
  });

  describe('unter lg', () => {
    // Breite VOR dem Render: antds Beobachter ruft seinen Zuhörer beim
    // Abonnieren synchron auf und liest dabei nur `matches`.
    beforeEach(() => setzeViewportBreite(390));

    it('legt beide Umschalter ab und behält das Benutzermenü', async () => {
      setup(admin);
      // Der Trigger trägt hier keinen Namen mehr, deshalb hängt das Warten am
      // `aria-label` statt am Anzeigenamen.
      expect(await screen.findByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup', { name: 'Farbschema wählen' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('radiogroup', { name: 'Bediendichte wählen' }),
      ).not.toBeInTheDocument();
      // Der Anzeigename ist mit dem Trigger geschrumpft — die drei
      // Bestandsfälle oben laufen deshalb bewusst auf der Standardbreite.
      expect(screen.queryByText('Chef')).not.toBeInTheDocument();
    });
  });
});
