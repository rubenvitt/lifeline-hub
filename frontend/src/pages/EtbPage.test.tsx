import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EtbPage from './EtbPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'THW', status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};
const eintrag = {
  id: 1, lfd_nr: 1, typ: 'meldung', inhalt: 'Erste Meldung', von: null, an: null,
  meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Admin',
  ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
  erfasst_lokal_at: null, berichtigt_eintrag_id: null,
};

function setup() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/etb', () => HttpResponse.json([eintrag])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/etb' },
  );
}

describe('EtbPage', () => {
  it('zeigt Einsatz-Bezeichnung und ETB-Einträge', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
  });
});
