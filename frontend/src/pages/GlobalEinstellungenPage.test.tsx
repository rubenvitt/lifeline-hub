import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../test/utils';
import GlobalEinstellungenPage from './GlobalEinstellungenPage';

// --- Mocks ---

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/orgEinstellungen', () => ({
  ladeOrgEinstellungen: vi.fn(),
  speichereOrgEinstellungen: vi.fn(),
  ladeOrgModulEinstellungen: vi.fn(),
  setzeOrgModulEinstellung: vi.fn(),
}));

import { useAuth } from '../auth/AuthContext';
import {
  ladeOrgEinstellungen,
  speichereOrgEinstellungen,
  ladeOrgModulEinstellungen,
  setzeOrgModulEinstellung,
} from '../api/orgEinstellungen';

// --- Hilfsfunktionen ---

const LEERE_EINSTELLUNGEN = {
  zeitzone: null,
  zeitformat: null,
  einheiten: null,
  koordinatenformat: null,
  retention_dauer_tage: null,
  etb_nummer_praefix: null,
  meldung_nummer_praefix: null,
  auftrag_nummer_praefix: null,
  meldung_bestaetigung_frist_min: null,
  auftrag_quittierung_frist_min: null,
  auto_etb_eintraege: null,
  geocoder_url: null,
  geaendert_at: null,
  geaendert_von: null,
};

function rendern() {
  return renderMitProviders(<GlobalEinstellungenPage />);
}

describe('GlobalEinstellungenPage', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 1, system_rolle: 'admin', org_rolle: 'keine', anzeigename: 'Admin', benutzername: 'admin', aktiv: true, erstellt_at: '' },
      laedt: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({ ...LEERE_EINSTELLUNGEN });
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...LEERE_EINSTELLUNGEN });
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({});
    vi.mocked(setzeOrgModulEinstellung).mockResolvedValue(undefined);
  });

  // --- Sektionen sichtbar ---

  it('rendert alle vier Sektionen', async () => {
    rendern();

    expect(await screen.findByText('Anzeige-Konventionen')).toBeInTheDocument();
    expect(screen.getByText('Aufbewahrung')).toBeInTheDocument();
    expect(screen.getByText('Verhalten & Automatik')).toBeInTheDocument();
    expect(screen.getByText('Modul-Rollen-Default')).toBeInTheDocument();
  });

  // --- Feldabdeckung Submit (exakter Payload) ---

  it('sendet beim Submit alle Felder exakt im richtigen Format (Feldabdeckung)', async () => {
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({
      zeitzone: 'Europe/Berlin',
      zeitformat: '12h',
      einheiten: 'imperial',
      koordinatenformat: 'mgrs',
      retention_dauer_tage: 90,
      etb_nummer_praefix: 'EB-',
      meldung_nummer_praefix: 'M-',
      auftrag_nummer_praefix: 'A-',
      meldung_bestaetigung_frist_min: 30,
      auftrag_quittierung_frist_min: 45,
      auto_etb_eintraege: 0,
      geocoder_url: null,
      geaendert_at: null,
      geaendert_von: null,
    });
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...LEERE_EINSTELLUNGEN });

    rendern();

    const btn = await screen.findByRole('button', { name: 'Speichern' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith({
        zeitzone: 'Europe/Berlin',
        zeitformat: '12h',
        einheiten: 'imperial',
        koordinatenformat: 'mgrs',
        retention_dauer_tage: 90,
        etb_nummer_praefix: 'EB-',
        meldung_nummer_praefix: 'M-',
        auftrag_nummer_praefix: 'A-',
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 45,
        // auto_etb_eintraege: 0 → Switch aus → false
        auto_etb_eintraege: false,
        geocoder_url: null,
      }),
    );
  });

  it('sendet null-Felder bei leerem Formular', async () => {
    rendern();

    const btn = await screen.findByRole('button', { name: 'Speichern' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith({
        zeitzone: null,
        zeitformat: null,
        einheiten: null,
        koordinatenformat: null,
        retention_dauer_tage: null,
        etb_nummer_praefix: null,
        meldung_nummer_praefix: null,
        auftrag_nummer_praefix: null,
        meldung_bestaetigung_frist_min: null,
        auftrag_quittierung_frist_min: null,
        // auto_etb_eintraege: null → Standard = an → true
        auto_etb_eintraege: true,
        geocoder_url: null,
      }),
    );
  });

  // --- Berechtigungen: admin editierbar ---

  it('zeigt den Speichern-Button als admin', async () => {
    rendern();
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  it('hat als admin editierbare Felder', async () => {
    rendern();

    // Warte auf Laden
    await screen.findByText('Anzeige-Konventionen');
    // Retention-Feld muss editierbar sein
    const retField = screen.getByLabelText('Aufbewahrungs-Dauer (Tage)');
    expect(retField).not.toBeDisabled();
  });

  // --- Berechtigungen: fuehrungskraft read-only ---

  it('deaktiviert alle Felder als Nicht-Admin (fuehrungskraft)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 2, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'FK', benutzername: 'fk', aktiv: true, erstellt_at: '' },
      laedt: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    rendern();

    await screen.findByText('Anzeige-Konventionen');

    // Retention-Feld disabled
    const retField = screen.getByLabelText('Aufbewahrungs-Dauer (Tage)');
    expect(retField).toBeDisabled();

    // Submit-Button fehlt oder ist disabled
    const btn = screen.queryByRole('button', { name: 'Speichern' });
    if (btn) {
      expect(btn).toBeDisabled();
    }
  });

  it('deaktiviert Modul-Rollen-Selects als Nicht-Admin (fuehrungskraft)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 2, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'FK', benutzername: 'fk', aktiv: true, erstellt_at: '' },
      laedt: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    rendern();

    // Warte auf Laden
    await screen.findByText('Modul-Rollen-Default');

    // Alle Modul-Comboboxen (benoetigte Rolle je Modul) müssen disabled sein
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    for (const sel of selects) {
      expect(sel).toBeDisabled();
    }
  });

  it('deaktiviert nicht-ausblendbare Modul-Selects auch als Admin', async () => {
    // 'einsatzdaten' und 'einsatz-einstellungen' sind NICHT_AUSBLENDBAR —
    // der Rollen-Default-Select soll für Admins trotzdem deaktiviert sein.
    rendern();

    await screen.findByText('Modul-Rollen-Default');

    const einsatzdatenSelect = screen.getByRole('combobox', {
      name: 'Benötigte Rolle: Einsatzdaten',
    });
    expect(einsatzdatenSelect).toBeDisabled();

    const einstellungenSelect = screen.getByRole('combobox', {
      name: 'Benötigte Rolle: Einstellungen',
    });
    expect(einstellungenSelect).toBeDisabled();

    // Ein ausblendbareres Modul (z. B. ETB) soll als Admin editierbar sein.
    const etbSelect = screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' });
    expect(etbSelect).not.toBeDisabled();
  });

  // --- Modul-Rollen-Default: Sofortmutation ---

  // --- Geocoder-URL ---

  it('zeigt das Geocoder-URL-Feld und sendet es beim Speichern', async () => {
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...LEERE_EINSTELLUNGEN });

    rendern();

    const feld = await screen.findByLabelText(/Geocoder-URL/i);
    await userEvent.type(feld, 'https://nominatim.example.org');
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith(
        expect.objectContaining({ geocoder_url: 'https://nominatim.example.org' }),
      ),
    );
  });

  it('speichert Modul-Rollen-Default sofort per PUT', async () => {
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({ etb: 'fuehrungskraft' });

    rendern();
    await screen.findByText('Modul-Rollen-Default');

    // Wähle 'admin' für ETB-Modul
    // combobox-Rolle: antd Select rendern alle als combobox
    const etbSelect = screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' });
    fireEvent.mouseDown(etbSelect);
    const adminOpt = await screen.findByText('Admin');
    fireEvent.click(adminOpt);

    await waitFor(() =>
      expect(setzeOrgModulEinstellung).toHaveBeenCalledWith('etb', 'admin'),
    );
  });
});
