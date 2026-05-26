import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import StatusKatalogTab from './StatusKatalogTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const status = [
  { id: 1, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, fms_anker: 1, sortier: 10 },
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(status)),
  );
  return renderMitProviders(
    <AuthProvider>
      <StatusKatalogTab />
    </AuthProvider>,
  );
}

describe('StatusKatalogTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('einsatzbereit')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('einsatzbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('einsatzbereit');
    expect(screen.queryByRole('button', { name: 'Status anlegen' })).not.toBeInTheDocument();
  });
});
