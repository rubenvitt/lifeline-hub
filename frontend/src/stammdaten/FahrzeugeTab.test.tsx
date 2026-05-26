import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import FahrzeugeTab from './FahrzeugeTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const fahrzeug = {
  id: 1, funkrufname: 'Florian 1', fahrzeugtyp: 'LF 20', traegerorganisation: null,
  kennzeichen: 'XX-AB 1', opta: null, standort: null, fms_issi: null, sondersignal: false,
  tragenkapazitaet: null, staerke: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
  bemerkung: null, dienststatus: 'in_dienst', angelegt_at: '2026-05-26 10:00:00',
};

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([fahrzeug])),
    http.get('/api/fahrzeug-vorschlaege', () =>
      HttpResponse.json({ fahrzeugtyp: ['LF 20'], traegerorganisation: [], standort: [] }),
    ),
  );
  return renderMitProviders(
    <AuthProvider>
      <FahrzeugeTab />
    </AuthProvider>,
  );
}

describe('FahrzeugeTab', () => {
  it('zeigt Fahrzeuge inkl. Stärke', async () => {
    render(admin);
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
    expect(screen.getByText('0/1/8/9')).toBeInTheDocument();
  });

  it('Admin sieht „Fahrzeug anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: 'Fahrzeug anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Fahrzeug anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
