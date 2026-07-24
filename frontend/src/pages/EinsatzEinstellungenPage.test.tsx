import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderMitProviders } from '../test/utils';
import EinsatzEinstellungenPage from './EinsatzEinstellungenPage';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, system_rolle: 'admin' } }),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
  speichereEinstellungen: vi.fn(),
  ladeModulOverrides: vi.fn(),
  setzeModulOverride: vi.fn(),
}));

vi.mock('../api/orgEinstellungen', () => ({
  ladeOrgModulEinstellungen: vi.fn(),
}));

import {
  ladeEinsatz, ladeEinstellungen, speichereEinstellungen,
  ladeModulOverrides, setzeModulOverride,
} from '../api/einsaetze';
import { ladeOrgModulEinstellungen } from '../api/orgEinstellungen';

// Verhalten & Automatik (LFH-133) — Default-Felder, in jeden Einstellungs-Mock gespreizt.
const VERHALTEN_DEFAULTS = {
  etb_nummer_praefix: null, etb_nummer_start: null,
  meldung_nummer_praefix: null, meldung_nummer_start: null,
  auftrag_nummer_praefix: null, auftrag_nummer_start: null,
  meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null,
  auto_etb_eintraege: null,
  etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false,
  // Aufbewahrung & Archiv (LFH-135).
  retention_dauer_tage: null,
  org_defaults: { org_id: 1 },
};

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
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(setzeModulOverride).mockResolvedValue({} as never);
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({});
  });

  it('zeigt die gespeicherten Werte (Default-Modul)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null,
      geaendert_von: null,
    });

    rendern();

    // Sektionen + gespeicherte Werte sichtbar (async: nach Query-Auflösung).
    expect(await screen.findByText('Standard-Modul (Einstieg)')).toBeInTheDocument();
    // Karten-Defaults (Basemap/Fachebenen) sind seit LFH-319 aus dem Formular entfernt.
    expect(screen.queryByText('Karten-Defaults')).not.toBeInTheDocument();
    // Gewähltes Standard-Modul: das Select-Selection-Item trägt title="ETB"
    // ('ETB' kommt jetzt auch als Modul-Label in der Sichtbarkeits-Sektion vor).
    expect(screen.getByTitle('ETB')).toBeInTheDocument();
  });

  it('lässt die Karten-Defaults (basemap/fachebenen/zoom) als Bestandswert im Payload mitfahren (LFH-319)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null,
      geaendert_von: null,
    });
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);

    rendern();

    const btn = await screen.findByRole('button', { name: 'Speichern' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(1, {
        standard_modul: 'etb',
        // Karten-Defaults sind aus dem Formular entfernt (leben auf der Karte, LFH-319),
        // fahren aber mit ihrem Bestandswert mit — sonst nullt der Vollersatz-UPSERT sie.
        basemap_modus: 'offline',
        karten_zoom_start: 12,
        fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
        // Anzeige-Konventionen (LFH-136) — hier nicht gesetzt → null (Default).
        zeitzone: null,
        zeitformat: null,
        einheiten: null,
        koordinatenformat: null,
        // Verhalten & Automatik (LFH-133) — Feldabdeckung: alle Felder im Payload.
        etb_nummer_praefix: null,
        etb_nummer_start: null,
        meldung_nummer_praefix: null,
        meldung_nummer_start: null,
        auftrag_nummer_praefix: null,
        auftrag_nummer_start: null,
        meldung_bestaetigung_frist_min: null,
        auftrag_quittierung_frist_min: null,
        // auto_etb: null im Datensatz → Select leer (Org-Standard erben) → null im Payload.
        auto_etb_eintraege: null,
        // Aufbewahrung & Archiv (LFH-135) — nicht gesetzt → null.
        retention_dauer_tage: null,
      }),
    );
  });

  it('zeigt die gespeicherten Anzeige-Konventionen vor und sendet sie im Payload (LFH-136)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: 'Europe/Berlin', zeitformat: '12h', einheiten: 'imperial', koordinatenformat: 'mgrs',
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
    });
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);

    rendern();

    // Sektion + vorbelegte Werte sichtbar.
    expect(await screen.findByText('Anzeige-Konventionen')).toBeInTheDocument();
    expect(screen.getByTitle('12 Stunden (AM/PM)')).toBeInTheDocument();
    expect(screen.getByTitle('Imperial (ft, mi)')).toBeInTheDocument();
    expect(screen.getByTitle('MGRS')).toBeInTheDocument();

    // Speichern reicht die geladenen Konventionen durch (Feldabdeckung).
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          zeitzone: 'Europe/Berlin',
          zeitformat: '12h',
          einheiten: 'imperial',
          koordinatenformat: 'mgrs',
        }),
      ),
    );
  });

  it('zeigt die Modul-Sichtbarkeits-Sektion; nicht-ausblendbare Module sind gesperrt (LFH-132)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
    });

    rendern();

    expect(await screen.findByText('Modul-Sichtbarkeit & Berechtigungen')).toBeInTheDocument();
    // Stammdaten lassen sich nicht ausblenden → Switch UND Rollen-Select deaktiviert.
    expect(screen.getByRole('switch', { name: 'Sichtbar: Einsatzdaten' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Einsatzdaten' })).toBeDisabled();
    // ETB ist ausblendbar → Switch aktiv und (Default) eingeschaltet.
    const etbSwitch = screen.getByRole('switch', { name: 'Sichtbar: ETB' });
    expect(etbSwitch).toBeEnabled();
    expect(etbSwitch).toBeChecked();
  });

  it('speichert das Ausblenden eines Moduls sofort per PUT (LFH-132)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
    });

    rendern();

    const etbSwitch = await screen.findByRole('switch', { name: 'Sichtbar: ETB' });
    fireEvent.click(etbSwitch);

    await waitFor(() =>
      expect(setzeModulOverride).toHaveBeenCalledWith(1, 'etb', {
        sichtbar: false,
        benoetigte_rolle: null,
      }),
    );
  });

  it('blendet einen Hinweis ein, wenn der Einsatz abgeschlossen ist', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1, bezeichnung: 'Lage', status: 'abgeschlossen', meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
    });

    rendern();

    expect(await screen.findByText(/eingefroren/)).toBeInTheDocument();
  });

  it('zeigt die Verhalten-Felder vor und sendet sie im Payload (LFH-133)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      etb_nummer_praefix: 'EB-', etb_nummer_start: 100,
      meldung_bestaetigung_frist_min: 30, auftrag_quittierung_frist_min: 45,
      auto_etb_eintraege: 0,
      geaendert_at: null, geaendert_von: null,
    });
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);

    rendern();

    // Sektion + vorbelegte Werte sichtbar.
    expect(await screen.findByText('Verhalten & Automatik')).toBeInTheDocument();
    expect((screen.getByLabelText('Präfix ETB') as HTMLInputElement).value).toBe('EB-');

    // Speichern reicht die Verhalten-Felder durch (Feldabdeckung).
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          etb_nummer_praefix: 'EB-',
          etb_nummer_start: 100,
          meldung_bestaetigung_frist_min: 30,
          auftrag_quittierung_frist_min: 45,
          // auto_etb_eintraege: 0 im Datensatz → Switch aus → false im Payload.
          auto_etb_eintraege: false,
        }),
      ),
    );
  });

  it('zeigt die Aufbewahrungs-Dauer vor und sendet sie im Payload (LFH-135)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      retention_dauer_tage: 365,
      geaendert_at: null, geaendert_von: null,
    });
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);

    rendern();

    // Sektion + vorbelegter Wert sichtbar.
    expect(await screen.findByText('Aufbewahrung & Archiv')).toBeInTheDocument();
    expect((screen.getByLabelText('Aufbewahrungs-Dauer (Tage)') as HTMLInputElement).value).toBe('365');

    // Speichern reicht die Dauer durch (Feldabdeckung).
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ retention_dauer_tage: 365 }),
      ),
    );
  });

  it('deaktiviert das Aufbewahrungs-Feld bei abgeschlossenem Einsatz (LFH-135)', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1, bezeichnung: 'Lage', status: 'abgeschlossen', meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
    });

    rendern();

    expect(await screen.findByLabelText('Aufbewahrungs-Dauer (Tage)')).toBeDisabled();
  });

  it('sperrt Präfix/Startwert eines eingefrorenen Nummernkreises (LFH-133)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      etb_nummer_eingefroren: true,
      geaendert_at: null, geaendert_von: null,
    });

    rendern();

    // ETB-Kreis eingefroren → Präfix-Feld disabled; Auftrags-Kreis frei → editierbar.
    expect(await screen.findByLabelText('Präfix ETB')).toBeDisabled();
    expect(screen.getByLabelText('Präfix Aufträge')).toBeEnabled();
  });

  // Task 15: Org-Standard-Hinweise

  it('zeigt Org-Standard-Hinweise bei leeren Einsatz-Feldern (Task 15)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      // Einsatz-Felder alle leer → Org-Standard soll angezeigt werden.
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
      org_defaults: {
        zeitzone: 'Europe/Berlin',
        zeitformat: '24h',
        einheiten: 'metrisch',
        koordinatenformat: 'wgs84',
        retention_dauer_tage: 365,
        etb_nummer_praefix: 'EB-',
        meldung_nummer_praefix: 'ME-',
        auftrag_nummer_praefix: 'AU-',
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 60,
        auto_etb_eintraege: 1,
        org_id: 1,
      },
    });

    rendern();

    // Zeitzone-Hinweis.
    expect(await screen.findByText('Standard (Org): Europe/Berlin')).toBeInTheDocument();
    // Zeitformat-Hinweis (Label aus ZEITFORMAT_OPTIONEN).
    expect(screen.getByText('Standard (Org): 24 Stunden')).toBeInTheDocument();
    // Einheiten-Hinweis.
    expect(screen.getByText('Standard (Org): Metrisch (m, km)')).toBeInTheDocument();
    // Koordinatenformat-Hinweis.
    expect(screen.getByText('Standard (Org): WGS84 dezimal')).toBeInTheDocument();
    // Aufbewahrung-Hinweis.
    expect(screen.getByText('Standard (Org): 365 Tage')).toBeInTheDocument();
    // Präfix-Hinweise.
    expect(screen.getByText('Standard (Org): EB-')).toBeInTheDocument();
    // Meldungs-Frist-Hinweis.
    expect(screen.getByText('Standard (Org): 30 Min.')).toBeInTheDocument();
    // Auftrags-Frist-Hinweis.
    expect(screen.getByText('Standard (Org): 60 Min.')).toBeInTheDocument();
    // Auto-ETB-Hinweis (1 = an).
    expect(screen.getByText('Standard (Org): An')).toBeInTheDocument();
  });

  it('sendet weiterhin null für leere Felder wenn org_defaults gesetzt sind (Task 15)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
      org_defaults: {
        zeitzone: 'Europe/Berlin',
        zeitformat: '24h',
        einheiten: 'metrisch',
        koordinatenformat: 'wgs84',
        retention_dauer_tage: 365,
        etb_nummer_praefix: 'EB-',
        meldung_nummer_praefix: 'ME-',
        auftrag_nummer_praefix: 'AU-',
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 60,
        auto_etb_eintraege: 1,
        org_id: 1,
      },
    });
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);

    rendern();

    const btn = await screen.findByRole('button', { name: 'Speichern' });
    fireEvent.click(btn);

    // Org-Defaults dürfen NICHT in den Payload fließen — leer = null (Org-Standard greift im Backend).
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(1, expect.objectContaining({
        zeitzone: null,
        zeitformat: null,
        einheiten: null,
        koordinatenformat: null,
        retention_dauer_tage: null,
        etb_nummer_praefix: null,
        meldung_bestaetigung_frist_min: null,
        auftrag_quittierung_frist_min: null,
      })),
    );
  });

  // Finding E: Tristate auto_etb_eintraege
  it('erbt Org-Standard für auto_etb (einsatz=null + org_default=Aus) → Payload null', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      // Einsatz hat keinen Override → null (erbt Org).
      auto_etb_eintraege: null,
      geaendert_at: null, geaendert_von: null,
      org_defaults: {
        zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
        retention_dauer_tage: null,
        etb_nummer_praefix: null, meldung_nummer_praefix: null, auftrag_nummer_praefix: null,
        meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null,
        // Org-Default: 0 = Aus.
        auto_etb_eintraege: 0,
        org_id: 1,
      },
    });
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);

    rendern();

    // Org-Hinweis „Standard (Org): Aus" soll angezeigt werden.
    expect(await screen.findByText('Standard (Org): Aus')).toBeInTheDocument();

    // Submit sendet null (kein Einsatz-Override; Backend löst Org-Default auf).
    const btn = screen.getByRole('button', { name: 'Speichern' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ auto_etb_eintraege: null }),
      ),
    );
  });

  it('zeigt Org-Rollen-Hinweis im Modul-Override (Task 15)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      ...VERHALTEN_DEFAULTS,
      geaendert_at: null, geaendert_von: null,
    });
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({
      etb: 'fuehrungskraft',
    });

    rendern();

    // Org-Rollen-Default für ETB-Modul soll sichtbar sein.
    expect(await screen.findByText('Org: Führungskraft')).toBeInTheDocument();
  });
});
