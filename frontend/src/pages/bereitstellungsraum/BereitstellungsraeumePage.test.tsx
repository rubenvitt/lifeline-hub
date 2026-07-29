import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import BereitstellungsraeumePage from './BereitstellungsraeumePage';
import type { Bereitstellungsraum, EinsatzAnzeige } from '../../api/types';

function einsatz(over: Partial<EinsatzAnzeige> = {}): EinsatzAnzeige {
  return {
    id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv',
    begonnen_at: 'x', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: 'x',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Org',
    ...over,
  };
}

function br(over: Partial<Bereitstellungsraum> = {}): Bereitstellungsraum {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, bezeichnung: 'BR Ost',
    standort: null, notiz: null, status: 'aktiv',
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1,
    storniert_at: null,
    ...over,
  };
}

function renderPage() {
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/bereitstellungsraeume" element={<BereitstellungsraeumePage />} />
    </Routes>,
    { route: '/einsaetze/1/bereitstellungsraeume' },
  );
}

describe('BereitstellungsraeumePage', () => {
  it('zeigt die Bereitstellungsräume der Lage', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([br()])),
    );
    renderPage();
    expect(await screen.findByText('BR Ost')).toBeInTheDocument();
  });

  /**
   * AK4-Regressionsklammer (LFH-331 · B3) zur Ebenen-Trennung D3: die Listen-Query
   * gehört an die Stelle der Liste, nicht in den Seitenguard. Vor dem Umbau blieb die
   * Seite bei gescheitertem Abruf im Ladebild stehen und sagte nie, was los war.
   *
   * Beide Hälften nennen dasselbe Leertext-Literal — die negative Zusicherung soll eine
   * Aussage über die Zustandsweiche sein, nicht über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => new HttpResponse(null, { status: 500 })),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Bereitstellungsräume erfasst')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Liste den Leertext und KEINEN Fehler', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Eine vollständig stornierte Liste ist ein echter Leerzustand: der Seitenfilter
   * (`storniert_at`) läuft durch dieselbe Weiche wie eine leere Antwort. Ohne diesen
   * Fall bliebe der Filter unbelegt, obwohl er die Menge auf null bringen kann.
   */
  it('behandelt eine ausschließlich stornierte Liste als Leerzustand', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br({ storniert_at: '2026-07-29 10:00:00' })]),
      ),
    );
    renderPage();
    expect(await screen.findByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(screen.queryByText('BR Ost')).not.toBeInTheDocument();
  });
});
