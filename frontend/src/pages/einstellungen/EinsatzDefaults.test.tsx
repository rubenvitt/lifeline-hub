import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import EinsatzDefaults from './EinsatzDefaults';

vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/orgEinstellungen', () => ({
  ladeOrgEinstellungen: vi.fn(),
  speichereOrgEinstellungen: vi.fn(),
  ladeOrgModulEinstellungen: vi.fn(),
  setzeOrgModulEinstellung: vi.fn(),
}));

import { useAuth } from '../../auth/AuthContext';
import {
  ladeOrgEinstellungen,
  speichereOrgEinstellungen,
  ladeOrgModulEinstellungen,
  setzeOrgModulEinstellung,
} from '../../api/orgEinstellungen';

const VOLL = {
  org_id: 1,
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
  geocoder_url: 'https://geo.example',
  geaendert_at: null,
  geaendert_von: null,
};

function alsAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    benutzer: { id: 1, system_rolle: 'admin', org_rolle: 'keine', anzeigename: 'Admin', benutzername: 'admin', aktiv: true, erstellt_at: '', totp_aktiviert: false },
    laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
  } as never);
}

describe('EinsatzDefaults', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({} as never);
    vi.mocked(setzeOrgModulEinstellung).mockResolvedValue(undefined as never);
  });

  it('sendet beim Speichern den VOLLEN Payload — Anzeige-Felder bleiben erhalten (Vollersatz)', async () => {
    renderMitProviders(<EinsatzDefaults />);

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith({
        // Anzeige-Spalten NICHT genullt (aus geladenen Daten gemerged):
        zeitzone: 'Europe/Berlin',
        zeitformat: '12h',
        einheiten: 'imperial',
        koordinatenformat: 'mgrs',
        geocoder_url: 'https://geo.example',
        retention_dauer_tage: 90,
        etb_nummer_praefix: 'EB-',
        meldung_nummer_praefix: 'M-',
        auftrag_nummer_praefix: 'A-',
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 45,
        auto_etb_eintraege: false,
      }),
    );
  });

  it('geleertes Präfix-Feld geht als null raus (nicht "") — trim/leer→null-Semantik', async () => {
    renderMitProviders(<EinsatzDefaults />);

    const etb = await screen.findByLabelText('Präfix ETB');
    await userEvent.clear(etb);
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith(
        expect.objectContaining({ etb_nummer_praefix: null }),
      ),
    );
  });

  it('speichert Modul-Rollen-Default sofort per PUT', async () => {
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({ etb: 'fuehrungskraft' } as never);

    renderMitProviders(<EinsatzDefaults />);

    const etbSelect = await screen.findByRole('combobox', { name: 'Benötigte Rolle: ETB' });
    fireEvent.mouseDown(etbSelect);
    fireEvent.click(await screen.findByText('Admin'));

    await waitFor(() => expect(setzeOrgModulEinstellung).toHaveBeenCalledWith('etb', 'admin'));
  });

  it('ist read-only für Nicht-Admins (fuehrungskraft): kein Speichern-Button, Felder disabled', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 2, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'FK', benutzername: 'fk', aktiv: true, erstellt_at: '', totp_aktiviert: false },
      laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<EinsatzDefaults />);

    await screen.findByText('Aufbewahrung');
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Aufbewahrungs-Dauer (Tage)')).toBeDisabled();
  });
});
