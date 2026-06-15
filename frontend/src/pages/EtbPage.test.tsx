import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // Schnellerfassung lädt via useFunkrufnamen disponierte Fahrzeuge/Einheiten
    // (Absender/Empfänger-Vorschläge). Leere Listen genügen für diesen Test.
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
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
    // Bezeichnung erscheint als Überschrift (zusätzlich in der Breadcrumb-Zeile) → gezielt die Überschrift prüfen.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hochwasser Nord' })).toBeInTheDocument(),
    );
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
  });

  it('legt aus einem ETB-Eintrag eine Wiedervorlage mit ETB-Bezug an', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 99 }, { status: 201 });
      }),
    );
    setup();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Wiedervorlage' }));
    // Titel ist aus dem Eintragstext vorbefüllt.
    expect(await screen.findByDisplayValue(/Wiedervorlage: Erste Meldung/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.bezug_typ).toBe('etb');
    expect(body!.bezug_id).toBe(1);
    expect(body!.titel).toMatch(/Erste Meldung/);
  });
});
