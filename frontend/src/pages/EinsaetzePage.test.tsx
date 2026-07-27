import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
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

  it('öffnet den neuen Einsatz direkt nach dem Anlegen', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.post('/api/einsaetze', () =>
        HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 }),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/" element={<EinsaetzePage />} />
          <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
        </Routes>
      </AuthProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Workspace-7')).toBeInTheDocument());
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
    expect(screen.queryByRole('button', { name: 'Neuer Einsatz' })).not.toBeInTheDocument();
  });

  it('trennt aktive und abgeschlossene Einsätze in eigene Sektionen', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz(),
          einsatz({
            id: 8,
            bezeichnung: 'Sturmtief Abschluss',
            status: 'abgeschlossen',
            abgeschlossen_at: '2026-05-24 10:00:00',
          }),
        ]),
      ),
    );
    setup();
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(screen.getByText('Abgeschlossen')).toBeInTheDocument();
    expect(screen.getByText('Sturmtief Abschluss')).toBeInTheDocument();
  });

  it('oeffnet beim Klick auf eine Kachel den Workspace unter /einsaetze/:id', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/" element={<EinsaetzePage />} />
          <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
        </Routes>
      </AuthProvider>,
    );
    await userEvent.click(await screen.findByText('Hochwasser Nord'));
    await waitFor(() => expect(screen.getByText('Workspace-7')).toBeInTheDocument());
  });
});
