import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import type { Schichtplan } from '../api/types';
import SchichtplanDruckPage from './SchichtplanDruckPage';

/**
 * Laden der Druckansicht des Schichtplans (LLH-1557): eine gesperrte Nachbarliste (403) fehlt nur,
 * jeder andere Ladefehler sperrt den Druck, statt Blätter ohne Abschnitt oder Qualifikation zu
 * zeigen. Inhalt der Blätter: `abloesung/schichtplan/ausgabe/SchichtplanBlaetter.test.tsx`.
 */

const PLAN: Schichtplan = {
  grenzwerte: {
    max_dienst_minuten: 720,
    min_ruhe_minuten: 480,
    max_dienst_eigen: false,
    min_ruhe_eigen: false,
  },
  bloecke: [
    {
      id: 1,
      von: '2026-08-15 12:00:00',
      bis: '2026-08-15 15:00:00',
      posten: { art: 'uhs', uhs_id: 9, bezeichnung: 'UHS Marktplatz', aufgeloest: false },
      befunde: [],
      offene_anforderungen: [],
      offene_plaetze: 0,
      personen: [],
      personen_anzahl: 0,
      soll_anzahl: null,
      version: 1,
    },
  ],
  helfer: [],
};

function zeigen(handler: Parameters<typeof server.use>) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/einsaetze/5', () =>
      HttpResponse.json({ id: 5, bezeichnung: 'Stadtfest', status: 'aktiv' }),
    ),
    http.get('/api/organisation', () => HttpResponse.json({ id: 1, name: 'DRK Musterstadt' })),
    http.get('/api/einsaetze/5/abloesungen/schichtplan', () => HttpResponse.json(PLAN)),
    http.get('/api/einsaetze/5/abloesungen/vorgaben', () => HttpResponse.json([])),
    http.get('/api/einsaetze/5/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/5/uhs', () => HttpResponse.json([])),
    http.get('/api/qualifikationen', () => HttpResponse.json([])),
  );
  // Eigener Aufruf: innerhalb eines `server.use` gewinnt der erste passende Handler.
  server.use(...handler);
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/abloesung/schichtplan/druck" element={<SchichtplanDruckPage />} />
    </Routes>,
    { route: '/einsaetze/5/abloesung/schichtplan/druck' },
  );
}

const druckKnopf = () => screen.getByRole('button', { name: 'Drucken / als PDF' });

describe('SchichtplanDruckPage (LLH-1557)', () => {
  it('403 an der UHS-Liste: Blatt trotzdem da, Druck frei', async () => {
    zeigen([
      http.get('/api/einsaetze/5/uhs', () => HttpResponse.json({ error: 'x' }, { status: 403 })),
    ]);
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(screen.getByRole('heading', { name: /Aushang – UHS Marktplatz/ })).toBeInTheDocument();
  });

  it('Katalog scheitert: Ladefehler, Druck gesperrt', async () => {
    zeigen([
      http.get('/api/qualifikationen', () => HttpResponse.json({ error: 'x' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Der Schichtplan konnte nicht geladen werden')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Erneut laden' })).toBeInTheDocument();
    expect(druckKnopf()).toBeDisabled();
    expect(screen.queryByRole('heading', { name: /Aushang/ })).toBeNull();
  });
});
