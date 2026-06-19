import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderMitProviders } from '../test/utils';
import EinsatzEinstellungenPage from './EinsatzEinstellungenPage';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, system_rolle: 'admin' } }),
}));

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
  speichereEinstellungen: vi.fn(),
}));

import { ladeEinsatz, ladeEinstellungen } from '../api/einsaetze';

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen" element={<EinsatzEinstellungenPage />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen' },
  );
}

describe('EinsatzEinstellungenPage', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung',
    } as never);
  });

  it('zeigt die gespeicherten Werte (Default-Modul + Basemap)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
      geaendert_at: null,
      geaendert_von: null,
    });

    rendern();

    // Sektionen + gespeicherte Werte sichtbar (async: nach Query-Auflösung).
    expect(await screen.findByText('Standard-Modul (Einstieg)')).toBeInTheDocument();
    expect(screen.getByText('Karten-Defaults')).toBeInTheDocument();
    expect(screen.getByText('ETB')).toBeInTheDocument(); // gewähltes Standard-Modul
    expect(screen.getByText('Offline')).toBeInTheDocument(); // gewählte Basemap
  });

  it('blendet einen Hinweis ein, wenn der Einsatz abgeschlossen ist', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1, bezeichnung: 'Lage', status: 'abgeschlossen', meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null, geaendert_at: null, geaendert_von: null,
    });

    rendern();

    expect(await screen.findByText(/eingefroren/)).toBeInTheDocument();
  });
});
