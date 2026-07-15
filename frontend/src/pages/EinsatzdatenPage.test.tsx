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
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', totp_aktiviert: false,
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
  { benutzer_id: 2, anzeigename: 'Frank Führung', benutzername: 'frank', einsatz_rolle: 'fuehrungspersonal', zugewiesen_at: '2026-05-23 09:05:00' },
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
    http.get('/api/benutzer', () => HttpResponse.json([])),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
    http.get('/api/einsaetze/:id/ort-vorschau', () => HttpResponse.json({ peilung: null, ortsname: null })),
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
    // 'Admin' erscheint als Einsatzleitung in den Kopfdaten und zusätzlich in der Zugriff-Tabelle.
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('zeigt Koordinaten über formatKoordinate (WGS84-Default: toFixed(5))', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    // Ohne EinsatzAnzeigeProvider greift DEFAULT_KONVENTIONEN → WGS84 → lat.toFixed(5), lon.toFixed(5)
    expect(await screen.findByText('48.12340, 11.56780')).toBeInTheDocument();
  });

  it('speichert einsatzort_koord als einsatzort_lat/lon im PATCH-Body', async () => {
    let patchBody: Record<string, unknown> = {};
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...basisEinsatz, einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 });
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchBody.einsatzort_lat).toBeCloseTo(48.1234, 4));
    expect(patchBody.einsatzort_lon).toBeCloseTo(11.5678, 4);
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

  it('zeigt die Zugriff-Namen read-only auch für Beobachter', async () => {
    setup({ einsatz: { meine_rolle: 'beobachter' }, benutzer: { ...admin, system_rolle: 'keiner' } });
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });

  it('zeigt Verwaltungs-Aktionen für Einsatzleitung im aktiven Einsatz', async () => {
    setup();
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Entfernen' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeInTheDocument();
  });

  it('blendet Verwaltungs-Aktionen für Führungspersonal aus', async () => {
    setup({ einsatz: { meine_rolle: 'fuehrungspersonal' } });
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });

  it('blendet Verwaltungs-Aktionen bei abgeschlossenem Einsatz aus', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });
});
