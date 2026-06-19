import { screen, fireEvent, waitFor } from '@testing-library/react';
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
  ladeModulOverrides: vi.fn(),
  setzeModulOverride: vi.fn(),
}));

import {
  ladeEinsatz, ladeEinstellungen, speichereEinstellungen,
  ladeModulOverrides, setzeModulOverride,
} from '../api/einsaetze';

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
    // Gewähltes Standard-Modul: das Select-Selection-Item trägt title="ETB"
    // ('ETB' kommt jetzt auch als Modul-Label in der Sichtbarkeits-Sektion vor).
    expect(screen.getByTitle('ETB')).toBeInTheDocument();
    expect(screen.getByTitle('Offline')).toBeInTheDocument(); // gewählte Basemap
  });

  it('speichert den transformierten Payload (Fachebenen-Array → Objekt, Zoom-Passthrough)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
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
        basemap_modus: 'offline',
        // Start-Zoom wird unverändert durchgereicht (UI erhebt ihn noch nicht).
        karten_zoom_start: 12,
        // Checkbox-Array → Boolean-Objekt.
        fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
        // Anzeige-Konventionen (LFH-136) — hier nicht gesetzt → null (Default).
        zeitzone: null,
        zeitformat: null,
        einheiten: null,
        koordinatenformat: null,
      }),
    );
  });

  it('zeigt die gespeicherten Anzeige-Konventionen vor und sendet sie im Payload (LFH-136)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: 'Europe/Berlin', zeitformat: '12h', einheiten: 'imperial', koordinatenformat: 'mgrs',
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
      fachebenen_sichtbar: null, geaendert_at: null, geaendert_von: null,
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
      fachebenen_sichtbar: null, geaendert_at: null, geaendert_von: null,
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
      fachebenen_sichtbar: null, geaendert_at: null, geaendert_von: null,
    });

    rendern();

    expect(await screen.findByText(/eingefroren/)).toBeInTheDocument();
  });
});
