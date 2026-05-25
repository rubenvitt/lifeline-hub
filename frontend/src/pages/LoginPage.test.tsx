import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import LoginPage from './LoginPage';

function setup() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
  // Default: leere Dev-Benutzerliste → kein Picker, bestehender Test unverändert.
  server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
  return renderMitProviders(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

describe('LoginPage', () => {
  it('zeigt eine Server-Fehlermeldung bei falschen Anmeldedaten', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }),
      ),
    );
    setup();
    await userEvent.type(screen.getByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'falsch');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(screen.getByText('Nicht angemeldet')).toBeInTheDocument());
  });

  it('füllt das Formular bei Auswahl eines Dev-Benutzers', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(
      http.get('/api/dev/users', () =>
        HttpResponse.json([
          { benutzername: 'admin', passwort: 'dev', anzeigename: 'Administrator', rolle: 'Admin' },
        ]),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    const knopf = await screen.findByRole('button', { name: /Administrator/ });
    await userEvent.click(knopf);

    expect((screen.getByLabelText('Benutzername') as HTMLInputElement).value).toBe('admin');
    expect((screen.getByLabelText('Passwort') as HTMLInputElement).value).toBe('dev');
  });

  it('zeigt keinen Picker, wenn der Dev-Endpoint fehlt (404)', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(
      http.get('/api/dev/users', () =>
        HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    expect(await screen.findByLabelText('Benutzername')).toBeInTheDocument();
    expect(screen.queryByText('Dev-Schnellanmeldung')).not.toBeInTheDocument();
  });
});
