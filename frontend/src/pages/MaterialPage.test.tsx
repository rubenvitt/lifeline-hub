import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import MaterialPage from './MaterialPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};

const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};

const em = {
  id: 10, einsatz_id: 1, material_id: 5, einheit_id: null, ist_adhoc: false,
  bezeichnung: 'Wolldecke', kategorie: 'Betreuung', bestandsnummer: null, traegerorganisation: null,
  menge: 50, status: 'einsatzbereit', bemerkung: null,
  disponiert_at: '2026-05-27 09:00:00', disponiert_von: 1,
};

function render(einsatzObj: typeof einsatzAktiv, materialListe: typeof em[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json(materialListe)),
    http.get('/api/material', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/material' },
  );
}

describe('MaterialPage', () => {
  it('zeigt disponiertes Material mit Menge und Status', async () => {
    render(einsatzAktiv, [em]);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument(); // Mengen-Input (min 1)
  });

  it('Einsatzleitung sieht Disponier- und Ad-hoc-Aktionen', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Material' });
    expect(screen.getByRole('button', { name: 'Disponieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Material' })).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist reine Anzeige', async () => {
    const abgeschlossen = { ...einsatzAktiv, status: 'abgeschlossen' as const };
    render(abgeschlossen, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.queryByRole('button', { name: 'Disponieren' })).not.toBeInTheDocument();
    expect(screen.getByText('einsatzbereit')).toBeInTheDocument(); // Status-Badge statt Select
  });
});
