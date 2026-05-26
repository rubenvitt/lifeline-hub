import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import FahrzeugePage from './FahrzeugePage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-26 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: '2026-001', angelegt_at: '2026-05-26 09:00:00',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

const ef = {
  id: 10, einsatz_id: 7, fahrzeug_id: 1, ist_adhoc: false, funkrufname: 'Florian 1',
  kennzeichen: 'XX-AB 1', fahrzeugtyp: 'LF 20', opta: null, traegerorganisation: null,
  status_id: 2, status_label: 'disponiert', status_kategorie: 'gebunden', status_farbe: null,
  bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
};
const stati = [
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
  { id: 3, label: 'vor_ort', kategorie: 'gebunden', farbe: null, fms_anker: 4, sortier: 40 },
];

function render(einsatzObj: ReturnType<typeof einsatz>) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/fahrzeuge' },
  );
}

describe('FahrzeugePage', () => {
  it('zeigt disponierte Fahrzeuge', async () => {
    render(einsatz());
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
  });

  it('Einsatzleitung im aktiven Einsatz sieht Disponieren-/Entfernen-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByText('Stamm-Fahrzeug disponieren …')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter sieht reine Anzeige (Status-Badge statt Select)', async () => {
    render(einsatz({ meine_rolle: 'beobachter' }));
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Fahrzeug' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.getByText('disponiert')).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist read-only und zeigt Hinweis', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00' }));
    await screen.findByText('Florian 1');
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
  });
});
