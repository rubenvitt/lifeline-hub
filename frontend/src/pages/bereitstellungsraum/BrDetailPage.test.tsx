import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BrDetailPage from './BrDetailPage';
import type { BrDetail, EinsatzAnzeige, EinsatzFahrzeug } from '../../api/types';

// -------- Fixture-Builder --------

function einsatz(over: Partial<EinsatzAnzeige> = {}): EinsatzAnzeige {
  return {
    id: 1, bezeichnung: 'Test-Einsatz', stichwort: null, status: 'aktiv',
    begonnen_at: 'x', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: 'x',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'fuehrungspersonal', org_id: 1, org_name: 'Org',
    ...over,
  };
}

function brDetail(over: Partial<BrDetail> = {}): BrDetail {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, bezeichnung: 'BR Alpha',
    standort: null, notiz: null, status: 'aktiv',
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1,
    storniert_at: null, einheiten: [], fahrzeuge: [],
    ...over,
  };
}

function fahrzeug(over: Partial<EinsatzFahrzeug> = {}): EinsatzFahrzeug {
  return {
    id: 20, einsatz_id: 1, fahrzeug_id: null, einheit_id: null, ist_adhoc: true,
    funkrufname: 'Florian 1', kennzeichen: null, fahrzeugtyp: null, opta: null,
    traegerorganisation: null, status_id: null, status_label: null,
    status_kategorie: null, status_farbe: null, bemerkung: null,
    disponiert_at: 'x', disponiert_von: null,
    lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null,
    ...over,
  };
}

// -------- Render-Hilfe --------

function renderBrDetail(brId = 1) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[`/einsaetze/1/bereitstellungsraeume/${brId}`]}>
          <Routes>
            <Route path="/einsaetze/:id/bereitstellungsraeume/:brId" element={<BrDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

// -------- Tests --------

describe('BrDetailPage – bereitgestellte Einheiten + Austritt (LFH-14)', () => {
  it('zeigt bereitgestellte Einheiten und entfernt per Austritt', async () => {
    const br = brDetail({ einheiten: [{ id: 10, name: 'Einheit Alpha' }] });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    let capturedBody: unknown = null;
    server.use(
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: 1, einsatz_id: 1, br_id: 1, objekt_typ: 'einheit', objekt_id: 10,
          art: 'austritt', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
        });
      }),
    );

    renderBrDetail();

    // Einheit sichtbar
    expect(await screen.findByText('Einheit Alpha')).toBeInTheDocument();

    // entfernen-Button klicken
    const btn = screen.getByRole('button', { name: 'entfernen' });
    await userEvent.click(btn);

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({ art: 'austritt', objekt_typ: 'einheit', objekt_id: 10 });
  });
});

describe('BrDetailPage – Sidebar zuweisen (LFH-14)', () => {
  it('weist eine einheitenlose Kraft zu', async () => {
    // BR hat noch keine Mitglieder; einheitenloses Fahrzeug in Sidebar sichtbar
    const br = brDetail({ einheiten: [], fahrzeuge: [] });
    const frei = fahrzeug({ id: 20, funkrufname: 'Florian 1', einheit_id: null });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([frei])),
    );

    let capturedBody: unknown = null;
    server.use(
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: 2, einsatz_id: 1, br_id: 1, objekt_typ: 'fahrzeug', objekt_id: 20,
          art: 'eintritt', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
        });
      }),
    );

    renderBrDetail();

    // Fahrzeug in Sidebar sichtbar
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();

    // zuweisen-Button klicken
    const btn = screen.getByRole('button', { name: 'zuweisen' });
    await userEvent.click(btn);

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({ art: 'eintritt', objekt_typ: 'fahrzeug', objekt_id: 20 });
  });
});
