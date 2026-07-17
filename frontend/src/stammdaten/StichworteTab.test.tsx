import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import StichworteTab from './StichworteTab';

// Deckt das Admin-Gating der Stichwort-Sektion ab (früher via StammdatenPage.test, das mit
// der Sidebar-Umstellung entfällt — StichworteTab hatte keinen eigenen Test).

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

function renderTab(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([{ id: 1, text: 'H1' }])),
  );
  return renderMitProviders(
    <AuthProvider>
      <StichworteTab />
    </AuthProvider>,
  );
}

describe('StichworteTab', () => {
  it('zeigt geladene Stichworte', async () => {
    renderTab(admin);
    expect(await screen.findByText('H1')).toBeInTheDocument();
  });

  it('Admin sieht Hinzufügen und Löschen', async () => {
    renderTab(admin);
    await screen.findByText('H1');
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht weder Hinzufügen noch Löschen', async () => {
    renderTab(nichtAdmin);
    await screen.findByText('H1');
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });
});
