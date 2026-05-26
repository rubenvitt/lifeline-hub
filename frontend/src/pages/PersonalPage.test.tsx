import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalPage from './PersonalPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv', begonnen_at: '2026-05-26 09:00:00',
    abgeschlossen_at: null, abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null,
    angelegt_at: '2026-05-26 09:00:00', leitstellen_nr: null, einsatzort: null, einsatzort_lat: null,
    einsatzort_lon: null, meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

const disponiert = [
  {
    id: 10, einsatz_id: 7, personal_id: 5, ist_adhoc: false, name: 'Thomas Müller',
    funktion: 'Sanitäter, Gruppenführer', traegerorganisation: 'DRK', staerke_position: 'fuehrer',
    status_id: 2, status_label: 'alarmiert', status_kategorie: 'gebunden', status_farbe: null,
    bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
  },
];

function render(einsatzObj: ReturnType<typeof einsatz>) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(disponiert)),
    http.get('/api/personal-status', () => HttpResponse.json([
      { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
    ])),
    http.get('/api/personal', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/personal' },
  );
}

describe('PersonalPage', () => {
  it('zeigt disponiertes Personal mit Funktion und Position', async () => {
    render(einsatz());
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter, Gruppenführer')).toBeInTheDocument();
  });

  it('Leitung im aktiven Einsatz sieht Dispositions-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Ad-hoc-Person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter / abgeschlossen: reine Ansicht', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00', meine_rolle: 'beobachter' }));
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Person' })).not.toBeInTheDocument();
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
  });
});
