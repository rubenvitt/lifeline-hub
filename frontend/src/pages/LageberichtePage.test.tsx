import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import LageberichtePage from './LageberichtePage';
import LageberichtDetailPage from './LageberichtDetailPage';
import type { EinsatzAnzeige, LageberichtAnzeige } from '../api/types';

const admin = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};

const einsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-06-02 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-06-02 09:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Orga',
};

const bericht: LageberichtAnzeige = {
  id: 11, einsatz_id: 7, vorlage: 'freitext', titel: 'Lage 10:00', zeitstand: '2026-06-02 10:00:00',
  status: 'entwurf', abschnitte: [{ schluessel: 'text', text: 'Inhalt' }], version: 1,
  vorgaenger_id: null, ersteller_id: 1, ersteller_name: 'A', erstellt_at: '2026-06-02 10:00:00',
  aktualisiert_at: '2026-06-02 10:00:00', freigegeben_von_id: null, freigegeben_von_name: null,
  freigegeben_at: null, etb_eintrag_id: null,
};

function setup(berichte: LageberichtAnzeige[] = [bericht]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json(berichte)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/lageberichte' },
  );
}

const lagebericht7Abschnitte: LageberichtAnzeige = {
  ...bericht, id: 12, vorlage: 'lagebericht', titel: 'Lagevortrag',
  abschnitte: [
    { schluessel: 'auftrag', text: '' },
    { schluessel: 'gefahren_schadenlage', text: '' },
    { schluessel: 'eigene_lage', text: '' },
    { schluessel: 'lageentwicklung', text: '' },
    { schluessel: 'fuehrungsprobleme', text: '' },
    { schluessel: 'antraege_vorschlaege', text: '' },
    { schluessel: 'zusammenfassung', text: '' },
  ],
};

function setupDetail(lb: LageberichtAnzeige) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get(`/api/einsaetze/7/lageberichte/${lb.id}`, () => HttpResponse.json(lb)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route: `/einsaetze/7/lageberichte/${lb.id}` },
  );
}

describe('LageberichtDetailPage', () => {
  it('Entwurf-Editor zeigt ein Feld je Abschnitt der Vorlage', async () => {
    setupDetail(lagebericht7Abschnitte);
    expect(await screen.findByLabelText('Auftrag')).toBeInTheDocument();
    expect(screen.getByLabelText('Zusammenfassung')).toBeInTheDocument();
    expect(screen.getByLabelText('Gefahren-/Schadenlage')).toBeInTheDocument();
  });

  it('freigegebener Bericht ist read-only mit ETB-Link und Fortschreiben', async () => {
    setupDetail({
      ...lagebericht7Abschnitte, status: 'freigegeben', etb_eintrag_id: 99,
      freigegeben_von_name: 'A', freigegeben_at: '2026-06-02 11:00:00',
    });
    expect(await screen.findByRole('button', { name: /Fortschreiben/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Auftrag')).not.toBeInTheDocument();
  });

  it('Freigeben öffnet einen Bestätigungsdialog', async () => {
    setupDetail({ ...lagebericht7Abschnitte, abschnitte: [
      { schluessel: 'auftrag', text: 'X' }, { schluessel: 'gefahren_schadenlage', text: '' },
      { schluessel: 'eigene_lage', text: '' }, { schluessel: 'lageentwicklung', text: '' },
      { schluessel: 'fuehrungsprobleme', text: '' }, { schluessel: 'antraege_vorschlaege', text: '' },
      { schluessel: 'zusammenfassung', text: '' }] });
    await screen.findByRole('button', { name: /Freigeben/i });
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    expect(await screen.findByText(/endgültig|unveränderlich|ETB/i)).toBeInTheDocument();
  });
});

describe('LageberichtePage', () => {
  it('zeigt die Berichte des Einsatzes', async () => {
    setup();
    expect(await screen.findByText('Lage 10:00')).toBeInTheDocument();
  });

  it('zeigt für Schreibberechtigte den Anlegen-Button', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /Neuer Bericht/i })).toBeInTheDocument();
  });

  it('zeigt leeren Zustand ohne Berichte', async () => {
    setup([]);
    expect(await screen.findByText(/Noch keine Lageberichte/i)).toBeInTheDocument();
  });
});
