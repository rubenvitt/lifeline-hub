import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import LageDashboardPage from './LageDashboardPage';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const einsatz = {
  id: 1, bezeichnung: 'Hochwasser Musterstadt', stichwort: 'TH Hochwasser', status: 'aktiv',
  begonnen_at: '2026-06-08 06:12:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-06-08 06:12:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'THW Musterstadt',
};

const person = (sichtung: string | null, status = 'betroffen') => ({
  id: Math.floor(Math.random() * 1e9), einsatz_id: 1, registrier_nr: 1, status,
  name: null, vorname: null, geschlecht: null, geburtsdatum: null, alter_geschaetzt: null,
  herkunft_adresse: null, antreff_ort: null, melder_kontakt: null, notiz: null,
  erfasst_at: '2026-06-08 09:00:00', erfasst_von: 1, geaendert_at: '2026-06-08 09:00:00',
  geaendert_von: 1, storniert_at: null, aktuelle_sichtung: sichtung, aktuelle_sichtung_at: null,
  aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
});

interface Daten {
  personen?: unknown[]; uhs?: unknown[]; schaeden?: unknown[]; tiere?: unknown[];
  gefahren?: unknown[]; zonen?: unknown[]; lageberichte?: unknown[];
  einheiten?: unknown[]; personal?: unknown[]; fahrzeuge?: unknown[];
  material?: unknown[]; abschnitte?: unknown[];
  gefahrenStatus?: number;
}

function mockEndpunkte(d: Daten) {
  const json = (arr?: unknown[]) => HttpResponse.json(arr ?? []);
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/personen', () => json(d.personen)),
    http.get('/api/einsaetze/1/uhs', () => json(d.uhs)),
    http.get('/api/einsaetze/1/schaeden', () => json(d.schaeden)),
    http.get('/api/einsaetze/1/tiere', () => json(d.tiere)),
    http.get('/api/einsaetze/1/gefahrenmatrix', () =>
      d.gefahrenStatus ? new HttpResponse(null, { status: d.gefahrenStatus }) : json(d.gefahren)),
    http.get('/api/einsaetze/1/zonen', () => json(d.zonen)),
    http.get('/api/einsaetze/1/lageberichte', () => json(d.lageberichte)),
    http.get('/api/einsaetze/1/einheiten', () => json(d.einheiten)),
    http.get('/api/einsaetze/1/personal', () => json(d.personal)),
    http.get('/api/einsaetze/1/fahrzeuge', () => json(d.fahrzeuge)),
    http.get('/api/einsaetze/1/material', () => json(d.material)),
    http.get('/api/einsaetze/1/abschnitte', () => json(d.abschnitte)),
  );
}

function render() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
      <Route path="/einsaetze/:id/personen" element={<div>PERSONEN-MODUL</div>} />
    </Routes>,
    { route: '/einsaetze/1/lage-dashboard' },
  );
}

describe('LageDashboardPage', () => {
  it('zeigt den Einsatz-Kopf und die Leitzahlen', async () => {
    mockEndpunkte({
      personen: [person('sk1'), person('sk1'), person('sk3'), person(null, 'vermisst')],
    });
    render();
    expect(await screen.findByRole('heading', { name: 'Hochwasser Musterstadt' })).toBeInTheDocument();
    expect(await screen.findByText('Patienten (SK I–IV)')).toBeInTheDocument();
    const patienten = screen.getByText('Patienten (SK I–IV)').closest('.ant-statistic');
    expect(patienten).toHaveTextContent('3');
  });

  it('Leerzustand: null Daten → Dashboard rendert ohne Crash, Aufträge-Platzhalter sichtbar', async () => {
    mockEndpunkte({});
    render();
    expect(await screen.findByRole('heading', { name: 'Hochwasser Musterstadt' })).toBeInTheDocument();
    expect(screen.getByText(/Aufträge-Modul/i)).toBeInTheDocument();
  });

  it('Deep-Link: Klick auf Patienten-Leitzahl navigiert ins Personen-Modul', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    const patienten = await screen.findByText('Patienten (SK I–IV)');
    await userEvent.click(patienten);
    expect(await screen.findByText('PERSONEN-MODUL')).toBeInTheDocument();
  });

  it('Fehler-Resilienz: Gefahrenmatrix-Fehler → nur diese Kachel zeigt „—", Rest steht', async () => {
    mockEndpunkte({ personen: [person('sk1')], gefahrenStatus: 500 });
    render();
    expect(await screen.findByRole('heading', { name: 'Hochwasser Musterstadt' })).toBeInTheDocument();
    const patienten = screen.getByText('Patienten (SK I–IV)').closest('.ant-statistic');
    expect(patienten).toHaveTextContent('1');
    const warnstufe = screen.getByText('Höchste Warnstufe').closest('.ant-statistic');
    expect(warnstufe).toHaveTextContent('—');
  });
});
