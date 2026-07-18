import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import AnzeigeEinstellungen from './AnzeigeEinstellungen';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));
vi.mock('../../api/orgEinstellungen', () => ({
  ladeOrgEinstellungen: vi.fn(),
  speichereOrgEinstellungen: vi.fn(),
}));

import { useAuth } from '../../auth/AuthContext';
import { ladeOrgEinstellungen, speichereOrgEinstellungen } from '../../api/orgEinstellungen';

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
  geocoder_url: null,
  geaendert_at: null,
  geaendert_von: null,
};

function alsAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    benutzer: { id: 1, system_rolle: 'admin', org_rolle: 'keine', anzeigename: 'Admin', benutzername: 'admin', aktiv: true, erstellt_at: '', totp_aktiviert: false },
    laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
  } as never);
}

describe('AnzeigeEinstellungen', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
  });

  it('sendet beim Speichern den VOLLEN Payload — Einsatz-Default-Felder bleiben erhalten (Vollersatz)', async () => {
    renderMitProviders(<AnzeigeEinstellungen />);

    const btn = await screen.findByRole('button', { name: 'Speichern' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith({
        zeitzone: 'Europe/Berlin',
        zeitformat: '12h',
        einheiten: 'imperial',
        koordinatenformat: 'mgrs',
        // Einsatz-Default-Spalten NICHT genullt (aus geladenen Daten gemerged):
        retention_dauer_tage: 90,
        etb_nummer_praefix: 'EB-',
        meldung_nummer_praefix: 'M-',
        auftrag_nummer_praefix: 'A-',
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 45,
        auto_etb_eintraege: false,
        geocoder_url: null,
      }),
    );
  });

  it('eigenes geändertes Feld fließt ein, andere Sektion bleibt', async () => {
    renderMitProviders(<AnzeigeEinstellungen />);

    const feld = await screen.findByLabelText(/Geocoder-URL/i);
    await userEvent.type(feld, 'https://nominatim.example.org');
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith(
        expect.objectContaining({
          geocoder_url: 'https://nominatim.example.org',
          etb_nummer_praefix: 'EB-',
        }),
      ),
    );
  });

  it('ist read-only für Nicht-Admins (fuehrungskraft): kein Speichern-Button, Feld disabled', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 2, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'FK', benutzername: 'fk', aktiv: true, erstellt_at: '', totp_aktiviert: false },
      laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<AnzeigeEinstellungen />);

    await screen.findByText('Anzeige-Konventionen');
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Geocoder-URL/i)).toBeDisabled();
  });
});
