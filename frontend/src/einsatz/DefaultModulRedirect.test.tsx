import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
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
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null, meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null, meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false, retention_dauer_tage: null, geaendert_at: null, geaendert_von: null,
      org_defaults: { org_id: 1 },
    });
    rendern();
    expect(await screen.findByText('Dashboard-Inhalt')).toBeInTheDocument();
  });

  it('leitet auf das konfigurierte Standard-Modul um', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7, standard_modul: 'etb', basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null, meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null, meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false, retention_dauer_tage: null, geaendert_at: null, geaendert_von: null,
      org_defaults: { org_id: 1 },
    });
    rendern();
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
  });

  it('fällt bei unbekanntem Standard-Modul auf das Dashboard zurück', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7, standard_modul: 'gibtsnicht', basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null, meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null, meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false, retention_dauer_tage: null, geaendert_at: null, geaendert_von: null,
      org_defaults: { org_id: 1 },
    });
    rendern();
    expect(await screen.findByText('Dashboard-Inhalt')).toBeInTheDocument();
  });
});
