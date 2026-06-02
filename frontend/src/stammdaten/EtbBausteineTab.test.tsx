import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EtbBausteineTab from './EtbBausteineTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const bausteine = [
  { id: 1, label: 'Lage unverändert', typ: 'lage', inhalt: 'Lage unverändert.', meldeweg: null, veranlassung: null, sortier: 10 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/etb-bausteine', () => HttpResponse.json(bausteine)),
  );
  return renderMitProviders(
    <AuthProvider>
      <EtbBausteineTab />
    </AuthProvider>,
  );
}

describe('EtbBausteineTab', () => {
  it('zeigt Bausteine', async () => {
    render(admin);
    expect(await screen.findByText('Lage unverändert')).toBeInTheDocument();
  });

  it('Admin sieht Anlegen + Aktionen', async () => {
    render(admin);
    await screen.findByText('Lage unverändert');
    expect(screen.getByRole('button', { name: 'Baustein anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Lage unverändert');
    expect(screen.queryByRole('button', { name: 'Baustein anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
