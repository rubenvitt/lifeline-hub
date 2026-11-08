import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { adminFixture, freigabenFixture } from '../test/fixtures';
import { einsatzKeys } from '../api/queryKeys';
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

function zeigen(handler: Parameters<typeof server.use>, client = neuerQueryClient()) {
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
    { route: '/einsaetze/5/abloesung/schichtplan/druck', client },
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

  it('Freigaben scheitern: Listen trotzdem gefragt, ihr Fehler sperrt den Druck', async () => {
    zeigen([
      http.get('/api/einsaetze/5/modul-freigaben', () =>
        HttpResponse.json({ error: 'x' }, { status: 500 }),
      ),
      http.get('/api/einsaetze/5/uhs', () => HttpResponse.json({ error: 'x' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Der Schichtplan konnte nicht geladen werden')).toBeVisible();
    expect(druckKnopf()).toBeDisabled();
  });

  it('Freigaben scheitern, UHS-Liste 403: Blatt trotzdem da, Druck frei', async () => {
    zeigen([
      http.get('/api/einsaetze/5/modul-freigaben', () =>
        HttpResponse.json({ error: 'x' }, { status: 500 }),
      ),
      http.get('/api/einsaetze/5/uhs', () => HttpResponse.json({ error: 'x' }, { status: 403 })),
    ]);
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(screen.getByRole('heading', { name: /Aushang – UHS Marktplatz/ })).toBeInTheDocument();
  });

  it('Alter Stand der Freigaben im Cache: der Schnappschuss wartet auf den frischen', async () => {
    const client = neuerQueryClient();
    client.setQueryData(
      einsatzKeys.modulFreigaben(5),
      freigabenFixture({ unfallhilfsstellen: { zugriff: false } }),
      { updatedAt: 0 },
    );
    let uhsAbrufe = 0;
    zeigen(
      [
        http.get('/api/einsaetze/5/uhs', () => {
          uhsAbrufe += 1;
          return HttpResponse.json([]);
        }),
      ],
      client,
    );
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(uhsAbrufe).toBe(1);
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
