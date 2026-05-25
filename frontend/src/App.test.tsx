import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from './test/utils';
import { AuthProvider } from './auth/AuthContext';
import App from './App';
import { http, HttpResponse } from 'msw';
import { server } from './test/server';

describe('App', () => {
  it('rendert ohne Absturz und leitet zu /login um', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
    renderMitProviders(
      <AuthProvider>
        <App />
      </AuthProvider>,
      { route: '/' },
    );
    expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
  });
});
