import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import SprechgruppenTab from './SprechgruppenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const sprechgruppe = {
  id: 1,
  einsatz_id: null,
  einsatz_lokal: false,
  bezeichnung: '412_F_DRK',
  betriebsart: 'TMO',
  hinweis: 'Führungskanal',
  aktiv: true,
  sortier: 0,
};

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/sprechgruppen', () => HttpResponse.json([sprechgruppe])),
  );
  return renderMitProviders(
    <AuthProvider>
      <SprechgruppenTab />
    </AuthProvider>,
  );
}

describe('SprechgruppenTab', () => {
  it('zeigt Katalog-Sprechgruppen', async () => {
    render(admin);
    expect(await screen.findByText('412_F_DRK')).toBeInTheDocument();
  });

  it('zeigt Betriebsart als Tag', async () => {
    render(admin);
    await screen.findByText('412_F_DRK');
    expect(screen.getByText('TMO')).toBeInTheDocument();
  });

  it('Admin sieht „Sprechgruppe anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('412_F_DRK');
    expect(screen.getByRole('button', { name: 'Sprechgruppe anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('412_F_DRK');
    expect(screen.queryByRole('button', { name: 'Sprechgruppe anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
