import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinsaetzePage from './EinsaetzePage';

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

function einsatz(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    bezeichnung: 'Hochwasser Nord',
    stichwort: 'THW',
    status: 'aktiv',
    begonnen_at: '2026-05-23 09:00:00',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    meine_rolle: 'einsatzleitung',
    ...over,
  };
}

function setup() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(admin)));
  return renderMitProviders(
    <AuthProvider>
      <EinsaetzePage />
    </AuthProvider>,
  );
}

describe('EinsaetzePage', () => {
  it('listet Einsätze mit Bezeichnung und eigener Rolle', async () => {
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    setup();
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(screen.getByText('einsatzleitung')).toBeInTheDocument();
  });

  it('legt einen neuen Einsatz an und zeigt ihn danach in der Liste', async () => {
    let angelegt = false;
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json(angelegt ? [einsatz({ bezeichnung: 'Sturm Süd' })] : []),
      ),
      http.post('/api/einsaetze', async () => {
        angelegt = true;
        return HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 });
      }),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Einsatz anlegen' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Sturm Süd')).toBeInTheDocument());
  });

  it('zeigt den Anlege-Button nicht für Nutzer ohne Recht', async () => {
    const ohneRecht = { ...admin, system_rolle: 'keiner', org_rolle: 'keine' };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(ohneRecht)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])),
    );
    renderMitProviders(
      <AuthProvider>
        <EinsaetzePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Einsatz anlegen' })).not.toBeInTheDocument();
  });
});
