import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import type { EinsatzEinstellungen, ModulFreigaben } from '../api/types';
import DefaultModulRedirect from './DefaultModulRedirect';

vi.mock('../api/incidents', () => ({ ladeEinstellungen: vi.fn(), ladeModulFreigaben: vi.fn() }));
import { ladeEinstellungen, ladeModulFreigaben } from '../api/incidents';

/** Jede Adresse, die der Router zeigt, in der Reihenfolge des Erscheinens. */
const besucht: string[] = [];
function AdressSonde() {
  const { pathname, search } = useLocation();
  besucht.push(`${pathname}${search}`);
  return <span data-testid="adresse">{`${pathname}${search}`}</span>;
}

function rendern(route = '/einsaetze/7') {
  return renderMitProviders(
    <>
      <Routes>
        <Route path="/einsaetze" element={<div>Einsatzliste</div>} />
        <Route path="/einsaetze/:id" element={<DefaultModulRedirect />} />
        <Route path="/einsaetze/:id/ueberblick" element={<div>Überblick-Inhalt</div>} />
        <Route path="/einsaetze/:id/etb" element={<div>ETB-Inhalt</div>} />
        <Route path="/einsaetze/:id/fahrzeuge" element={<div>Fahrzeuge-Inhalt</div>} />
      </Routes>
      <AdressSonde />
    </>,
    { route },
  );
}

/** Einstellungen ohne Override, nur `standard_modul` gesetzt. */
function einstellungen(standardModul: string | null): EinsatzEinstellungen {
  return {
    einsatz_id: 8,
    standard_modul: standardModul,
    basemap_modus: null,
    karten_zoom_start: null,
    fachebenen_sichtbar: null,
    zeitzone: null,
    zeitdarstellung: null,
    einheiten: null,
    koordinatenformat: null,
    etb_nummer_praefix: null,
    etb_nummer_start: null,
    meldung_nummer_praefix: null,
    meldung_nummer_start: null,
    auftrag_nummer_praefix: null,
    auftrag_nummer_start: null,
    meldung_bestaetigung_frist_min: null,
    auftrag_quittierung_frist_min: null,
    auto_etb_eintraege: null,
    etb_nummer_eingefroren: false,
    meldung_nummer_eingefroren: false,
    auftrag_nummer_eingefroren: false,
    retention_dauer_tage: null,
    geaendert_at: null,
    geaendert_von: null,
    org_defaults: { org_id: 1 },
  } as EinsatzEinstellungen;
}

describe('DefaultModulRedirect', () => {
  beforeEach(() => {
    vi.mocked(ladeEinstellungen).mockReset();
    vi.mocked(ladeModulFreigaben).mockReset();
    besucht.length = 0;
  });

  it('leitet bei ungültiger Einsatz-ID auf die Einsatzliste, ohne Einstellungen zu laden (LFH-438)', async () => {
    rendern('/einsaetze/abc');
    expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
    expect(ladeEinstellungen).not.toHaveBeenCalled();
  });

  it('leitet ohne Override auf den Führungsüberblick um', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7,
      standard_modul: null,
      basemap_modus: null,
      karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null,
      zeitdarstellung: null,
      einheiten: null,
      koordinatenformat: null,
      etb_nummer_praefix: null,
      etb_nummer_start: null,
      meldung_nummer_praefix: null,
      meldung_nummer_start: null,
      auftrag_nummer_praefix: null,
      auftrag_nummer_start: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: null,
      etb_nummer_eingefroren: false,
      meldung_nummer_eingefroren: false,
      auftrag_nummer_eingefroren: false,
      retention_dauer_tage: null,
      geaendert_at: null,
      geaendert_von: null,
      org_defaults: { org_id: 1 },
    });
    rendern();
    expect(await screen.findByText('Überblick-Inhalt')).toBeInTheDocument();
  });

  it('leitet auf das konfigurierte Standard-Modul um', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7,
      standard_modul: 'etb',
      basemap_modus: null,
      karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null,
      zeitdarstellung: null,
      einheiten: null,
      koordinatenformat: null,
      etb_nummer_praefix: null,
      etb_nummer_start: null,
      meldung_nummer_praefix: null,
      meldung_nummer_start: null,
      auftrag_nummer_praefix: null,
      auftrag_nummer_start: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: null,
      etb_nummer_eingefroren: false,
      meldung_nummer_eingefroren: false,
      auftrag_nummer_eingefroren: false,
      retention_dauer_tage: null,
      geaendert_at: null,
      geaendert_von: null,
      org_defaults: { org_id: 1 },
    });
    rendern();
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
  });

  it('fällt bei unbekanntem Standard-Modul auf den Überblick zurück', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 7,
      standard_modul: 'gibtsnicht',
      basemap_modus: null,
      karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null,
      zeitdarstellung: null,
      einheiten: null,
      koordinatenformat: null,
      etb_nummer_praefix: null,
      etb_nummer_start: null,
      meldung_nummer_praefix: null,
      meldung_nummer_start: null,
      auftrag_nummer_praefix: null,
      auftrag_nummer_start: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: null,
      etb_nummer_eingefroren: false,
      meldung_nummer_eingefroren: false,
      auftrag_nummer_eingefroren: false,
      retention_dauer_tage: null,
      geaendert_at: null,
      geaendert_von: null,
      org_defaults: { org_id: 1 },
    });
    rendern();
    expect(await screen.findByText('Überblick-Inhalt')).toBeInTheDocument();
  });

  it('lädt ohne Modul-Hinweis keine Freigaben (Weiche wie bisher)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(einstellungen('etb'));
    rendern('/einsaetze/8');
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
    expect(ladeModulFreigaben).not.toHaveBeenCalled();
  });
});

describe('DefaultModulRedirect — Modul-Hinweis des Einsatzwechsels (LLH-1821)', () => {
  beforeEach(() => {
    vi.mocked(ladeEinstellungen).mockReset();
    vi.mocked(ladeModulFreigaben).mockReset();
    besucht.length = 0;
  });

  it('leitet auf die Startseite des freien Moduls, der Hinweis verschwindet', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(einstellungen('etb'));
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
    rendern('/einsaetze/8?modul=fahrzeuge');
    expect(await screen.findByText('Fahrzeuge-Inhalt')).toBeInTheDocument();
    expect(screen.getByTestId('adresse')).toHaveTextContent(/^\/einsaetze\/8\/fahrzeuge$/);
    expect(ladeModulFreigaben).toHaveBeenCalledWith(8);
  });

  it('fällt bei gesperrtem Modul still aufs Standardmodul zurück', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(einstellungen('etb'));
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ fahrzeuge: { zugriff: false } }),
    );
    rendern('/einsaetze/8?modul=fahrzeuge');
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
    expect(besucht.some((a) => a.includes('/fahrzeuge'))).toBe(false);
  });

  it('fällt bei ausgeblendetem Modul (Vorlage) still aufs Standardmodul zurück', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(einstellungen(null));
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ fahrzeuge: { sichtbar: false, zugriff: true } }),
    );
    rendern('/einsaetze/8?modul=fahrzeuge');
    expect(await screen.findByText('Überblick-Inhalt')).toBeInTheDocument();
    expect(besucht.some((a) => a.includes('/fahrzeuge'))).toBe(false);
  });

  it('fällt ohne Freigaben (Abruf gescheitert) aufs Standardmodul zurück', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(einstellungen('etb'));
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new Error('503'));
    rendern('/einsaetze/8?modul=fahrzeuge');
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
  });

  it('verwirft einen unbekannten Hinweis und fragt keine Freigaben ab', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(einstellungen('etb'));
    rendern('/einsaetze/8?modul=gibtsnicht');
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
    expect(screen.getByTestId('adresse')).toHaveTextContent(/^\/einsaetze\/8\/etb$/);
    expect(ladeModulFreigaben).not.toHaveBeenCalled();
  });

  it('wartet auf die Freigaben, statt erst aufs Standardmodul zu springen (keine Doppel-Navigation)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(einstellungen(null));
    let freigabenLiefern: (f: ModulFreigaben) => void = () => {};
    vi.mocked(ladeModulFreigaben).mockReturnValue(
      new Promise<ModulFreigaben>((resolve) => {
        freigabenLiefern = resolve;
      }),
    );
    rendern('/einsaetze/8?modul=fahrzeuge');
    // Die Einstellungen sind da, die Freigaben nicht: die Weiche bleibt stehen.
    await vi.waitFor(() => expect(ladeEinstellungen).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('adresse')).toHaveTextContent('/einsaetze/8?modul=fahrzeuge');
    freigabenLiefern(freigabenFixture());
    expect(await screen.findByText('Fahrzeuge-Inhalt')).toBeInTheDocument();
    // Nie über den Überblick: genau ein Ziel nach der Index-Route.
    expect(besucht.some((a) => a.includes('/ueberblick'))).toBe(false);
  });
});
