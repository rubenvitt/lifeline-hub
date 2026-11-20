/**
 * LLH-1770: Die Anmeldeseite nennt den Grund auch dann, wenn eine Umleitung ihn nicht im
 * Navigationszustand mitbrachte (etwa die von `RequireAuth` nach dem Wegfall des Benutzers).
 */
import { http, HttpResponse } from 'msw';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { authWertFixture } from '../test/fixtures';
import LoginPage from './LoginPage';

vi.mock('../auth/AuthContext', async (echt) => ({
  ...(await echt<typeof import('../auth/AuthContext')>()),
  useAuth: () => ({ ...authWertFixture(null), sitzungBeendet: true }),
}));

describe('LoginPage nach Sitzungsende (LLH-1770)', () => {
  it('nennt den Grund aus dem AuthProvider', async () => {
    server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { von: '/einsaetze/4' } }]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Sitzung beendet – bitte erneut anmelden')).toBeInTheDocument();
  });
});
