import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
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

function handlers(rolle = 'einsatzleitung', status = 'aktiv', matrix: unknown[] = []) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/gefahrenmatrix', () => HttpResponse.json(matrix)),
  ];
}

function renderPage() {
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} />
    </Routes>,
    { route: '/einsaetze/1/gefahren' },
  );
}

describe('GefahrenPage', () => {
  it('rendert das 13×5-Raster (13 Gefahrentyp-Zeilen, 5 Schutzobjekt-Spalten)', async () => {
    server.use(...handlers());
    renderPage();
    // antd Table rendert eine Maßzeile → mehrere Elemente; findAllByText + [0] ist die kanonische Umgehung.
    expect((await screen.findAllByText('Brand'))[0]).toBeInTheDocument();
    expect(screen.getAllByText('Atemgifte')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Ertrinken')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Menschen')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Einsatzkräfte')[0]).toBeInTheDocument();
  });

  it('setzt eine Warnstufe und ruft die API (PUT)', async () => {
    let put: { gefahrentyp: string; schutzobjekt: string; warnstufe: string } | null = null;
    server.use(
      ...handlers(),
      http.put('/api/einsaetze/1/gefahrenmatrix/bewertung', async ({ request }) => {
        put = (await request.json()) as typeof put;
        return HttpResponse.json({
          id: 1, einsatz_id: 1, gefahrentyp: put!.gefahrentyp, schutzobjekt: put!.schutzobjekt,
          warnstufe: put!.warnstufe, beschreibung: null, gemeldet_von: null, aktualisiert_von: 1,
          erstellt_at: '', geaendert_at: '',
        });
      }),
    );
    renderPage();
    // Zelle (brand × menschen): aria-label am Select. antd Table → mehrere → [0] nehmen.
    // Klick auf das innere combobox-Input öffnet das Dropdown sicher.
    const zellen = await screen.findAllByLabelText('Warnstufe brand × menschen');
    const zelle = zellen[0];
    const combobox = zelle.querySelector('input[role="combobox"]') ?? zelle;
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByText('Hoch'));
    await waitFor(() => expect(put).toEqual({ gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch' }));
  });

  it('graut ungültige Kombinationen aus (sachwerte × atemgifte disabled)', async () => {
    server.use(...handlers());
    renderPage();
    // antd Table → mehrere Elemente mit gleichem aria-label; [0] = erste echte Zeile.
    const zellen = await screen.findAllByLabelText('Warnstufe atemgifte × sachwerte');
    expect(zellen[0]).toHaveClass('ant-select-disabled');
  });
});
