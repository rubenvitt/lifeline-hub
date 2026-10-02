import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { AuthProvider, useAuth } from './AuthContext';

/**
 * LFH-767, Review-Befund: Ein Tab mit altem Bundle hält die Entwurfs-DB in v1 offen, das Upgrade
 * auf v2 bleibt dann `blocked` — jeder Zugriff hängt. Das Räumen der Gerätedaten darf deshalb
 * weder Anmeldung noch Start noch Abmeldung aufhalten. Nachgestellt mit Räumschritten, die nie
 * fertig werden.
 */
vi.mock('../offline/geraetRaeumung', () => ({
  geraetRaeumen: () => new Promise<void>(() => {}),
  geraetFuerBenutzerRaeumen: () => new Promise<void>(() => {}),
}));

const ich = adminFixture();
let logoutFertig = false;

function Anzeige() {
  const { benutzer, laedt, login, logout } = useAuth();
  if (laedt) return <div>lädt…</div>;
  return (
    <div>
      <span data-testid="name">{benutzer ? benutzer.anzeigename : 'anonym'}</span>
      <button onClick={() => void login('admin', 'pw')}>login</button>
      <button onClick={() => void logout().then(() => (logoutFertig = true))}>logout</button>
    </div>
  );
}

function rendern() {
  render(
    <QueryClientProvider client={neuerQueryClient()}>
      <AuthProvider>
        <Anzeige />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Hängendes Räumen hält den Auth-Pfad nicht auf (LFH-767)', () => {
  it('Start mit 401 endet, Anmeldung übernimmt die Person', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.post('/api/auth/login', () => HttpResponse.json(ich)),
    );
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));

    await userEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(ich.anzeigename));
  });

  it('Start ohne Server endet, Abmelden kehrt zurück', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.error()));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));

    server.use(
      meHandler(ich),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.post('/api/auth/login', () => HttpResponse.json(ich)),
    );
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(ich.anzeigename));
    logoutFertig = false;
    await userEvent.click(screen.getByText('logout'));

    await waitFor(() => expect(logoutFertig).toBe(true));
    expect(screen.getByTestId('name')).toHaveTextContent('anonym');
  });
});
