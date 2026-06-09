import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import GefahrenPage from './GefahrenPage';

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};
const gebiet = { id: 7, einsatz_id: 1, label: 'Nord', zonen_ids: [9], hoechste_warnstufe: 'hoch' };

function handlers(gebiete: unknown[] = [gebiet], matrix: unknown[] = []) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json(gebiete)),
    http.get('/api/einsaetze/1/gefahrengebiete/7/matrix', () => HttpResponse.json(matrix)),
  ];
}
function renderPage() {
  renderMitProviders(
    <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>,
    { route: '/einsaetze/1/gefahren' },
  );
}

describe('GefahrenPage', () => {
  it('listet Gefahrengebiete und zeigt die Matrix des gewählten', async () => {
    server.use(...handlers());
    renderPage();
    expect(await screen.findByText('Nord')).toBeInTheDocument();
    // Erstes Gebiet automatisch gewählt → Matrix sichtbar.
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
  });

  it('zeigt Leerzustand ohne Gefahrengebiete', async () => {
    server.use(...handlers([]));
    renderPage();
    expect(await screen.findByText(/keine Gefahrengebiete/i)).toBeInTheDocument();
  });

  it('setzt eine Warnstufe (PUT auf das gewählte Gebiet)', async () => {
    let put: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.put('/api/einsaetze/1/gefahrengebiete/7/matrix/bewertung', async ({ request }) => {
        put = (await request.json()) as typeof put;
        return HttpResponse.json({ id: 1, gefahrengebiet_id: 7, ...put, beschreibung: null, gemeldet_von: null, aktualisiert_von: 1, erstellt_at: '', geaendert_at: '' });
      }),
    );
    renderPage();
    const zellen = await screen.findAllByLabelText('Warnstufe brand × menschen');
    const combobox = zellen[0].querySelector('input[role="combobox"]') ?? zellen[0];
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByText('Hoch'));
    await screen.findByText('Nord'); // settle
    expect(put).toMatchObject({ gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch' });
  });
});
