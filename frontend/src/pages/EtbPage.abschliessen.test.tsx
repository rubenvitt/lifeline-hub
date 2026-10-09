import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EtbPage from './EtbPage';
import { benutzerFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';

// Normaler Benutzer (kein System-Admin): geprüft wird die Einsatz-Rolle; dass die Systemrolle
// fürs Schreiben nicht zählt, deckt schreibrecht.test.ts ab.
const nutzer = benutzerFixture();
function einsatz(status: string) {
  return {
    id: 7,
    bezeichnung: 'Hochwasser',
    stichwort: null,
    status,
    begonnen_at: '2026-05-23 09:00:00',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    meine_rolle: 'einsatzleitung',
  };
}

describe('EtbPage – kein Einsatzabschluss (LFH-960)', () => {
  /**
   * Der Abschluss steht seit LFH-960 auf den Einsatzdaten (`EinsatzdatenPage.test.tsx`): ein Fehltipp
   * neben dem Typfilter schloss sonst den Einsatz für alle. Auch die Einsatzleitung findet ihn im
   * ETB weder im Kopf (ab Tablet quer) noch im Menü „Weitere“ (Handschirm, `EtbPage.test.tsx`).
   */
  it.each([1180, 1440])(
    'zeigt auch der Einsatzleitung keinen Abschluss im Kopf (%i px)',
    async (breite) => {
      setzeViewportBreite(breite);
      server.use(
        meHandler(nutzer),
        http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz('aktiv'))),
        http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
        http.get('/api/einsaetze/7/etb/zaehler', () =>
          HttpResponse.json({
            gesamt: 0,
            je_typ: {
              meldung: 0,
              anordnung: 0,
              lage: 0,
              entscheidung: 0,
              system: 0,
              berichtigung: 0,
            },
          }),
        ),
      );
      renderMitProviders(
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>,
        { route: '/einsaetze/7/etb' },
      );
      // Vorbedingung: der Kopf steht mit seinen Aktionen.
      expect(await screen.findByRole('link', { name: 'Drucken / als PDF' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Einsatz abschließen' })).toBeNull();
      expect(screen.queryByText('Einsatz abschließen')).toBeNull();
    },
  );

  it('zeigt Beobachtern keine Schreib-/Verwaltungsaktionen (read-only)', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz('aktiv'), meine_rolle: 'beobachter' }),
      ),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/etb/zaehler', () =>
        HttpResponse.json({
          gesamt: 0,
          je_typ: {
            meldung: 0,
            anordnung: 0,
            lage: 0,
            entscheidung: 0,
            system: 0,
            berichtigung: 0,
          },
        }),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
      </Routes>,
      { route: '/einsaetze/7/etb' },
    );
    await screen.findByRole('heading', { name: 'ETB' });
    expect(screen.queryByRole('button', { name: 'Erfassen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mitglieder' })).not.toBeInTheDocument();
  });
});
