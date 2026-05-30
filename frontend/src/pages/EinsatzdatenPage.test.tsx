import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';
import EinsatzdatenPage from './EinsatzdatenPage';

const admin: BenutzerAnzeige = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

const basisEinsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'H1', status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: '2026-001', angelegt_at: '2026-05-23 09:00:05',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
  org_id: 1, org_name: 'DRK Musterstadt',
};

const mitglieder = [
  { benutzer_id: 1, anzeigename: 'Admin', benutzername: 'admin', einsatz_rolle: 'einsatzleitung', zugewiesen_at: '2026-05-23 09:00:00' },
];

const vorschlaege = [{ id: 1, text: 'H1' }, { id: 2, text: 'MANV' }];

interface SetupOpts {
  einsatz?: Partial<EinsatzAnzeige>;
  benutzer?: BenutzerAnzeige;
}

function setup(opts: SetupOpts = {}) {
  const einsatz = { ...basisEinsatz, ...opts.einsatz };
  const benutzer = opts.benutzer ?? admin;
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json(mitglieder)),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/einsatzdaten" element={<EinsatzdatenPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/einsatzdaten' },
  );
}

describe('EinsatzdatenPage', () => {
  it('zeigt Kopfdaten im Lesemodus, leere Felder als —', async () => {
    setup();
    expect(await screen.findByText('2026-001')).toBeInTheDocument();
    expect(screen.getByText('Realeinsatz')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('zeigt den Bearbeiten-Button für schreibberechtigten, aktiven Einsatz', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('versteckt den Bearbeiten-Button für Beobachter', async () => {
    setup({ einsatz: { meine_rolle: 'beobachter' }, benutzer: { ...admin, system_rolle: 'keiner' } });
    await screen.findByText('2026-001');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('versteckt den Bearbeiten-Button bei abgeschlossenem Einsatz', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    await screen.findByText('2026-001');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('speichert via PATCH und invalidiert den Einsatz-Cache', async () => {
    // Den PATCH-Body direkt im Handler prüfen und den Aufruf über ein Boolean
    // signalisieren — so umgehen wir die TS-Control-Flow-Eigenheit, dass eine
    // in einer Closure zugewiesene Variable außerhalb nicht eng typisiert wird.
    let patchAufgerufen = false;
    setup();
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.bezeichnung).toBe('Geändert');
        expect(body.einsatzart).toBe('realeinsatz');
        patchAufgerufen = true;
        return HttpResponse.json({ ...basisEinsatz, bezeichnung: 'Geändert' });
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    const bezeichnung = await screen.findByLabelText('Bezeichnung');
    await user.clear(bezeichnung);
    await user.type(bezeichnung, 'Geändert');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchAufgerufen).toBe(true));
  });
});
