import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinsatzabschnittePage from './EinsatzabschnittePage';

/** Abschnitt mit gefüllten Funk-Feldern für Vorbelegungs-/Anzeige-Tests. */
const funkAbschnitt = {
  id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord',
  leiter_id: null, leiter_name: null, bemerkung: null,
  flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
  sprechgruppe_tmo: '412_F_DRK', sprechgruppe_dmo: null,
  kommunikationsmittel: 'digitalfunk', erreichbarkeit: '0151 23456', sortier: 0,
};

function renderPage() {
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
    </Routes>,
    { route: '/einsaetze/1/einsatzabschnitte' },
  );
}

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};

function handlers(
  rolle = 'einsatzleitung',
  status = 'aktiv',
  abschnitte: unknown[] = [
    { id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord', leiter_id: null, leiter_name: 'Leiter Nord', bemerkung: null, sortier: 0 },
  ],
) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json(abschnitte)),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  ];
}

describe('EinsatzabschnittePage', () => {
  it('zeigt den Abschnitts-Baum mit Leiter', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    expect(await screen.findByText('Nord')).toBeInTheDocument();
    expect(screen.getByText(/Leiter Nord/)).toBeInTheDocument();
  });

  it('zeigt „Abschnitt anlegen" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    expect(await screen.findByRole('button', { name: 'Abschnitt anlegen' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    await screen.findByText('Nord');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Abschnitt anlegen' })).not.toBeInTheDocument(),
    );
  });

  it('zeigt Funk-Felder eines Abschnitts im Formular', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    expect(await screen.findByDisplayValue('412_F_DRK')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0151 23456')).toBeInTheDocument();
  });
});
