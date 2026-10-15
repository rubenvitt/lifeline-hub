import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { AuthProvider, useAuth } from './AuthContext';

const push = vi.hoisted(() => ({ pushAbgleichen: vi.fn(async () => undefined) }));
vi.mock('../alarm/webPush', () => push);

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

describe('AuthContext: Web Push nach einer neuen Sitzung (LLH-1223)', () => {
  it('gleicht beim Start und nach jedem Anmelden ab', async () => {
    const admin = adminFixture();
    server.use(
      meHandler(admin),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.post('/api/auth/login', () => HttpResponse.json(admin)),
    );
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
    await waitFor(() => expect(push.pushAbgleichen).toHaveBeenCalledWith(admin.id));
    const beimStart = push.pushAbgleichen.mock.calls.length;

    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
    await waitFor(() => expect(push.pushAbgleichen.mock.calls.length).toBeGreaterThan(beimStart));
  });
});
