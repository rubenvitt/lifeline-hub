import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderMitProviders } from '../test/utils';
import DefaultModulRedirect from './DefaultModulRedirect';

vi.mock('../api/einsaetze', () => ({ ladeEinstellungen: vi.fn() }));
import { ladeEinstellungen } from '../api/einsaetze';

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id" element={<DefaultModulRedirect />} />
      <Route path="/einsaetze/:id/lage-dashboard" element={<div>Dashboard-Inhalt</div>} />
      <Route path="/einsaetze/:id/etb" element={<div>ETB-Inhalt</div>} />
    </Routes>,
    { route: '/einsaetze/7' },
  );
}

describe('DefaultModulRedirect', () => {
  beforeEach(() => {
    vi.mocked(ladeEinstellungen).mockReset();
  });

  it('leitet ohne Override auf das Lage-Dashboard um', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null, geaendert_at: null, geaendert_von: null,
    });
    rendern();
    expect(await screen.findByText('Dashboard-Inhalt')).toBeInTheDocument();
  });

  it('leitet auf das konfigurierte Standard-Modul um', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7, standard_modul: 'etb', basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null, geaendert_at: null, geaendert_von: null,
    });
    rendern();
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
  });

  it('fällt bei unbekanntem Standard-Modul auf das Dashboard zurück', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7, standard_modul: 'gibtsnicht', basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null, geaendert_at: null, geaendert_von: null,
    });
    rendern();
    expect(await screen.findByText('Dashboard-Inhalt')).toBeInTheDocument();
  });
});
