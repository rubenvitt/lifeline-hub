import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalTab from './PersonalTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const personal = [
  {
    id: 1, benutzer_id: null, name: 'Thomas Müller', personalnummer: '4711',
    traegerorganisation: 'DRK', telefon: null, staerke_position: 'fuehrer',
    bemerkung: null, dienststatus: 'in_dienst', angelegt_at: '2026-05-26 10:00:00',
    qualifikationen: [{ id: 1, label: 'Sanitäter' }],
  },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/personal', () => HttpResponse.json(personal)),
    http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: ['DRK'] })),
    http.get('/api/qualifikationen', () => HttpResponse.json([{ id: 1, label: 'Sanitäter', sortier: 10 }])),
    http.get('/api/benutzer', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <PersonalTab />
    </AuthProvider>,
  );
}

describe('PersonalTab', () => {
  it('zeigt Personen mit Qualifikationen und Stärke-Position', async () => {
    render(admin);
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter')).toBeInTheDocument();
    expect(screen.getByText('Führer')).toBeInTheDocument();
  });

  it('Admin sieht „Person anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Person anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Person anlegen' })).not.toBeInTheDocument();
  });
});
