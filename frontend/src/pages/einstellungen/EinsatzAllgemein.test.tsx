import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzAllgemein from './EinsatzAllgemein';

// Die Systemrolle ist umschaltbar, weil `darfImEinsatzSchreiben` einen System-Admin unabhängig von
// `meine_rolle` durchlässt — ein fest auf 'admin' verdrahteter Mock löste den Rechte-Hinweis nie
// aus.
const { benutzerRolle } = vi.hoisted(() => ({ benutzerRolle: { wert: 'admin' } }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, system_rolle: benutzerRolle.wert } }),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('../../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
  speichereEinstellungen: vi.fn(),
}));

import { ladeEinsatz, ladeEinstellungen, speichereEinstellungen } from '../../api/einsaetze';
import { ApiError } from '../../api/client';

const BASIS = {
  einsatz_id: 1,
  standard_modul: null,
  basemap_modus: null,
  karten_zoom_start: null,
  fachebenen_sichtbar: null,
  zeitzone: null,
  zeitformat: null,
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
  org_defaults: { org_id: 1 },
  geaendert_at: null,
  geaendert_von: null,
};

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/allgemein" element={<EinsatzAllgemein />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/allgemein', datenRouter: true },
  );
}

describe('EinsatzAllgemein', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);
    benutzerRolle.wert = 'admin';
  });

  it('zeigt die gespeicherten Werte (Default-Modul)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
    } as never);

    rendern();

    expect(await screen.findByText('Standard-Modul (Einstieg)')).toBeInTheDocument();
    // Karten-Defaults (Basemap/Fachebenen) stehen nicht im Formular (sie leben auf der Lagekarte).
    expect(screen.queryByText('Karten-Defaults')).not.toBeInTheDocument();
    // Gewähltes Standard-Modul: das Select-Selection-Item trägt title="ETB".
    expect(screen.getByTitle('ETB')).toBeInTheDocument();
  });

  it('laesst die Karten-Defaults (basemap/fachebenen/zoom) als Bestandswert mitfahren (LFH-319)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
    } as never);

    rendern();
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          standard_modul: 'etb',
          basemap_modus: 'offline',
          karten_zoom_start: 12,
          fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
        }),
      ),
    );
  });

  it('zeigt die gespeicherten Anzeige-Konventionen vor und sendet sie im Payload (LFH-136)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      zeitzone: 'Europe/Berlin',
      zeitformat: '12h',
      einheiten: 'imperial',
      koordinatenformat: 'mgrs',
    } as never);

    rendern();

    expect(await screen.findByText('Anzeige-Konventionen')).toBeInTheDocument();
    expect(screen.getByTitle('12 Stunden (AM/PM)')).toBeInTheDocument();
    expect(screen.getByTitle('Imperial (ft, mi)')).toBeInTheDocument();
    expect(screen.getByTitle('MGRS')).toBeInTheDocument();

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

  it('zeigt Org-Standard-Hinweise bei leeren Einsatz-Feldern und sendet trotzdem null', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      org_defaults: {
        org_id: 1,
        zeitzone: 'Europe/Berlin',
        zeitformat: '24h',
        einheiten: 'metrisch',
        koordinatenformat: 'wgs84',
      },
    } as never);

    rendern();

    expect(await screen.findByText('Standard (Org): Europe/Berlin')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): 24 Stunden')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): Metrisch (m, km)')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): WGS84 dezimal')).toBeInTheDocument();

    // Der Org-Default darf NICHT in den Payload fließen — leer bleibt null (das Backend löst auf).
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          zeitzone: null,
          zeitformat: null,
          einheiten: null,
          koordinatenformat: null,
        }),
      ),
    );
  });

  /**
   * „Enter sendet ab" ist hier nicht per Tastendruck belegbar: alle Felder sind
   * `Select`/`AutoComplete`, und rc-select ruft bei jedem Enter `preventDefault()`. Prüfbar ist die
   * Struktur — der Absende-Knopf liegt im `<form>`.
   */
  it('haelt den Speichern-Knopf IM Formular (Erfassungs-Norm B4/LFH-332)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(BASIS as never);

    rendern();

    const knopf = await screen.findByRole('button', { name: 'Speichern' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });

  it('erklaert das fehlende Recht, statt nur auszugrauen (M16)', async () => {
    benutzerRolle.wert = 'benutzer';
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'beobachter',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue(BASIS as never);

    rendern();

    expect(await screen.findByText(/Nur die Einsatzleitung/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('nennt einen gescheiterten Speicherversuch dauerhaft auf der Seite (H14)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(BASIS as never);
    vi.mocked(speichereEinstellungen).mockRejectedValue(new ApiError(422, 'Zeitzone unbekannt'));

    rendern();
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    // Der Alert hängt an `mutation.error`, nicht an einer Toast-Queue mit eigener Lebensdauer.
    expect(await screen.findByText('Zeitzone unbekannt')).toBeInTheDocument();
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument();
  });
});
