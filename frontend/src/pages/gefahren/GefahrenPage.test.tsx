import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { neuerQueryClient, renderMitProviders } from '../../test/utils';
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
    // „Nord" erscheint in der Liste UND als editierbarer Titel → mehrere Treffer.
    expect((await screen.findAllByText('Nord'))[0]).toBeInTheDocument();
    // Erstes Gebiet automatisch gewählt → Matrix sichtbar.
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
  });

  it('zeigt Leerzustand ohne Gefahrengebiete', async () => {
    server.use(...handlers([]));
    renderPage();
    expect(await screen.findByText(/keine Gefahrengebiete/i)).toBeInTheDocument();
  });

  it('bietet „Auf Karte zeigen" mit Reverse-Deeplink auf die Lagekarte (LFH-155)', async () => {
    server.use(...handlers());
    renderPage();
    const link = await screen.findByRole('link', { name: /Auf Karte zeigen/i });
    expect(link).toHaveAttribute('href', '/einsaetze/1/lagekarte?gefahrengebiet=7');
  });

  it('korrigiert die Auswahl, wenn das gewählte Gebiet aus der Liste verschwindet', async () => {
    const nord = { id: 7, einsatz_id: 1, label: 'Nord', zonen_ids: [9], hoechste_warnstufe: 'hoch' };
    const sued = { id: 8, einsatz_id: 1, label: 'Süd', zonen_ids: [11], hoechste_warnstufe: 'mittel' };
    let aktuelle: unknown[] = [nord];
    let matrix8Angefragt = false;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json(aktuelle)),
      http.get('/api/einsaetze/1/gefahrengebiete/7/matrix', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/gefahrengebiete/8/matrix', () => {
        matrix8Angefragt = true;
        return HttpResponse.json([]);
      }),
    );
    const client = neuerQueryClient();
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>,
      { route: '/einsaetze/1/gefahren', client },
    );
    // Gebiet 7 (Nord) ist gewählt, seine Matrix gerendert.
    expect((await screen.findAllByText('Nord'))[0]).toBeInTheDocument();
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    // Refetch liefert nur noch Gebiet 8 (Süd) → Auswahl fällt auf das erste zurück.
    aktuelle = [sued];
    client.invalidateQueries({ queryKey: ['gefahrengebiete', 1] });
    expect((await screen.findAllByText('Süd'))[0]).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Nord')).not.toBeInTheDocument());
    // Matrix des neu gewählten Gebiets (8) wurde geladen.
    await waitFor(() => expect(matrix8Angefragt).toBe(true));
  });

  it('?gefahrengebiet= wählt das Zielgebiet statt des ersten — auch unter StrictMode (LFH-150)', async () => {
    const nord = { id: 7, einsatz_id: 1, label: 'Nord', zonen_ids: [9], hoechste_warnstufe: 'hoch' };
    const sued = { id: 8, einsatz_id: 1, label: 'Süd', zonen_ids: [11], hoechste_warnstufe: 'mittel' };
    const client = neuerQueryClient();
    // Wie nach Navigation von der Lagekarte: einsatz + gefahrengebiete sind bereits gecached
    // (gebieteQuery.isSuccess ist beim ersten Render true).
    client.setQueryData(['einsatz', 1], einsatz);
    client.setQueryData(['gefahrengebiete', 1], [nord, sued]);
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json([nord, sued])),
      http.get('/api/einsaetze/1/gefahrengebiete/7/matrix', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/gefahrengebiete/8/matrix', () => HttpResponse.json([])),
    );
    // StrictMode wie in der echten App (main.tsx): Effekte laufen doppelt — deckt das
    // Race zwischen Default-auf-erstes-Gebiet und Deeplink-Selektion auf.
    renderMitProviders(
      <StrictMode>
        <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>
      </StrictMode>,
      { route: '/einsaetze/1/gefahren?gefahrengebiet=8', client },
    );
    // FINALE Auswahl: der editierbare Titel (h5) zeigt NUR das gewählte Gebiet.
    const titel = await screen.findByRole('heading', { level: 5 });
    expect(titel).toHaveTextContent('Süd'); // NICHT 'Nord' (= Default aufs erste Gebiet)
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
    await screen.findAllByText('Nord'); // settle
    expect(put).toMatchObject({ gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch' });
  });

  it('benennt das gewählte Gefahrengebiet um (PATCH)', async () => {
    let patch: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/gefahrengebiete/7', async ({ request }) => {
        patch = (await request.json()) as typeof patch;
        return HttpResponse.json({ id: 7, einsatz_id: 1, label: (patch as { label: string }).label, zonen_ids: [9], hoechste_warnstufe: 'hoch' });
      }),
    );
    renderPage();
    // Editierbarer Titel des gewählten Gebiets „Nord" rendert ein Edit-Control.
    await screen.findAllByText('Nord');
    // antd Typography.editable rendert genau EIN Edit-Trigger-Button (aria-label „Edit").
    const editBtn = screen.getByLabelText('Edit');
    await userEvent.click(editBtn);
    const input = await screen.findByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Süd');
    // Das Edit-Feld ist ein <textarea>; Enter fügt sonst nur einen Umbruch ein.
    // Bestätigung robust über Enter-keyDown + Blur (löst editable.onChange aus).
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.blur(input);
    await waitFor(() => expect(patch).toEqual({ label: 'Süd' }));
  });
});
