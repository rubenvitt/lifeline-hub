import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider, useAuth } from './AuthContext';
import {
  SITZUNG_ABGELAUFEN,
  meldeSitzungAbgelaufen,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';

afterEach(() => sitzungsMeldungZuruecksetzen());

function Anzeige() {
  const { benutzer, laedt, login, logout } = useAuth();
  if (laedt) return <div>lädt…</div>;
  return (
    <div>
      <span data-testid="name">{benutzer ? benutzer.anzeigename : 'anonym'}</span>
      <button onClick={() => login('admin', 'pw')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

const adminBody = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

describe('AuthContext', () => {
  it('zeigt anonym, wenn /me 401 liefert', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
  });

  it('übernimmt den Benutzer nach erfolgreichem Login', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.post('/api/auth/login', () => HttpResponse.json(adminBody)),
    );
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
  });

  it('meldet lokal ab, auch wenn der Server-Logout scheitert (LFH-268)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(adminBody)),
      // session::loeschen propagiert seinen AppError (src/routes/auth.rs:226) — ein
      // SQLITE_BUSY unter Last reicht für einen 5xx.
      http.post('/api/auth/logout', () =>
        HttpResponse.json({ error: 'Datenbank belegt' }, { status: 500 }),
      ),
    );
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));

    await userEvent.click(screen.getByText('logout'));

    // Bliebe `benutzer` gesetzt, ließe RequireAuth geschützte Routen weiter passieren —
    // und die Sitzungswache meldete wegen ihrer Sperre keinen weiteren Ablauf mehr.
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    expect(konsole).toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('löst die Melde-Sperre nach erfolgreichem Login (LFH-268)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.post('/api/auth/login', () => HttpResponse.json(adminBody)),
    );
    // Sperre setzen — wie nach einem echten Sitzungsablauf.
    meldeSitzungAbgelaufen();

    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));

    // Ohne das Lösen bliebe ein SPÄTERER Ablauf in derselben Browser-Sitzung stumm.
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });
});
