import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinsatzLayout from './EinsatzLayout';

const admin = {
  id: 1, anzeigename: 'Chef', benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
  abgeschlossen_von: null, meine_rolle: 'einsatzleitung',
};

function setup() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route path="etb" element={<div>ETB-Inhalt</div>} />
        </Route>
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/etb' },
  );
}

describe('EinsatzLayout', () => {
  it('zeigt Switcher mit Einsatznamen, Kategorie-Rail und Outlet-Inhalt', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument();
  });
});
