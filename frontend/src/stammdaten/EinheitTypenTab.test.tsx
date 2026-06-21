import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinheitTypenTab from './EinheitTypenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const typen = [
  { id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 },
  { id: 2, label: 'Sonstige', soll: null, sortier: 50 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/einheit-typen', () => HttpResponse.json(typen)),
  );
  return renderMitProviders(
    <AuthProvider>
      <EinheitTypenTab />
    </AuthProvider>,
  );
}

describe('EinheitTypenTab', () => {
  it('zeigt Typen mit Soll-Stärke und „—" bei fehlender Soll', async () => {
    render(nichtAdmin);
    expect(await screen.findByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('Sonstige')).toBeInTheDocument();
  });

  it('Admin sieht „Typ anlegen"', async () => {
    render(admin);
    await screen.findByText('Zug');
    expect(screen.getByRole('button', { name: 'Typ anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Zug');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Typ anlegen' })).not.toBeInTheDocument(),
    );
  });
});
