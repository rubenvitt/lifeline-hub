import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App as AntApp } from 'antd';
import KraefteuebersichtPage from './KraefteuebersichtPage';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn(() => Promise.resolve({ id: 1, bezeichnung: 'Testeinsatz', status: 'aktiv', meine_rolle: 'einsatzleitung' })) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn(() => Promise.resolve([])) }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn(() => Promise.resolve([
  { id: 1, einsatz_id: 1, personal_id: null, einheit_id: null, ist_adhoc: false, name: 'P1',
    funktion: null, traegerorganisation: null, staerke_position: 'mannschaft', status_id: null,
    status_label: null, status_kategorie: 'gebunden', status_farbe: null, disponiert_at: '', disponiert_von: null },
])) }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn(() => Promise.resolve([])) }));
vi.mock('../api/einsatzMaterial', () => ({ listeEinsatzMaterial: vi.fn(() => Promise.resolve([])) }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn(() => Promise.resolve([])) }));
vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: vi.fn() }));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/kraefteuebersicht']}>
          <Routes><Route path="/einsaetze/:id/kraefteuebersicht" element={<KraefteuebersichtPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('KraefteuebersichtPage', () => {
  it('zeigt Titel und die Gesamt-Personalstärke im Kopf', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Kräfteübersicht' })).toBeInTheDocument();
    expect(await screen.findByText(/Gesamtstärke/i)).toBeInTheDocument();
    expect(await screen.findByText('0/0/1/1')).toBeInTheDocument();
  });
});
