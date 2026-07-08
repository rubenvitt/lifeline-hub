import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BrDetailPage from './BrDetailPage';
import type { BrDetail, EinsatzAnzeige, Einheit, EinsatzFahrzeug } from '../../api/types';

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
    aktueller_br_id: null, soll_besatzung: null,
    ...over,
  };
}

function einheit(over: Partial<Einheit> = {}): Einheit {
  return {
    id: 30, einsatz_id: 1, abschnitt_id: null, abschnitt_name: null,
    ueber_einheit_id: null, typ_id: null, typ_label: null, name: 'Einheit Beta',
    fuehrer_id: null, fuehrer_name: null, bemerkung: null, sortier: 0,
    soll: null, ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
    lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null,
    aktueller_br_id: null,
    sprechgruppen: [],
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

function renderBrBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/einsaetze/:id/bereitstellungsraeume" element={<div>BR-LISTE</div>} />
            <Route path="/einsaetze/:id/bereitstellungsraeume/:brId" element={<BrDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

// -------- Tests --------

describe('BrDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger BR-ID auf die Liste um', async () => {
    renderBrBei('/einsaetze/1/bereitstellungsraeume/abc');
    expect(await screen.findByText('BR-LISTE')).toBeInTheDocument();
  });
});

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

describe('BrDetailPage – Sidebar filtert auf aktueller_br_id == null (LFH-14)', () => {
  it('blendet Kräfte aus, die bereits in einem anderen BR sind', async () => {
    const br = brDetail({ id: 1, einheiten: [], fahrzeuge: [] });
    // Eine Einheit in keinem BR (frei), eine in einem ANDEREN BR (br 99).
    const frei = einheit({ id: 30, name: 'Einheit Frei', aktueller_br_id: null });
    const anderswo = einheit({ id: 31, name: 'Einheit Anderswo', aktueller_br_id: 99 });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([frei, anderswo])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    // Freie Einheit erscheint in der Sidebar …
    expect(await screen.findByText('Einheit Frei')).toBeInTheDocument();
    // … die in einem anderen BR darf NICHT erscheinen.
    expect(screen.queryByText('Einheit Anderswo')).not.toBeInTheDocument();
  });
});

describe('BrDetailPage – Schreibschutz (LFH-14)', () => {
  it('zeigt bei BR-Status geplant keine entfernen-/zuweisen-Buttons', async () => {
    // geplant → schreibgeschützt; bereitgestellte Einheit + freie Kraft in Sidebar.
    const br = brDetail({ status: 'geplant', einheiten: [{ id: 10, name: 'Einheit Alpha' }] });
    const frei = einheit({ id: 30, name: 'Einheit Frei', aktueller_br_id: null });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([frei])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    // Kräfte sind sichtbar …
    expect(await screen.findByText('Einheit Alpha')).toBeInTheDocument();
    expect(screen.getByText('Einheit Frei')).toBeInTheDocument();
    // … aber keine Schreibaktionen (entfernen/zuweisen).
    expect(screen.queryByRole('button', { name: 'entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'zuweisen' })).not.toBeInTheDocument();
  });

  it('zeigt für Beobachter keine entfernen-/zuweisen-Buttons (BR aktiv)', async () => {
    const br = brDetail({ status: 'aktiv', einheiten: [{ id: 10, name: 'Einheit Alpha' }] });
    const frei = einheit({ id: 30, name: 'Einheit Frei', aktueller_br_id: null });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz({ meine_rolle: 'beobachter' }))),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([frei])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    expect(await screen.findByText('Einheit Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'zuweisen' })).not.toBeInTheDocument();
  });
});
