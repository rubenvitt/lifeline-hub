import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import AppLayout from './AppLayout';

const admin = {
  id: 1,
  anzeigename: 'Chef',
  benutzername: 'chef',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

describe('AppLayout', () => {
  it('zeigt den Namen des angemeldeten Nutzers und den Admin-Link', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(admin)));
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>Inhalt</div>} />
          </Route>
        </Routes>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });
});
