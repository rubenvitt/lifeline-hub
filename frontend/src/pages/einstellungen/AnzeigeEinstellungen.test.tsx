import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
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
    benutzer: {
      id: 1,
      system_rolle: 'admin',
      org_rolle: 'keine',
      anzeigename: 'Admin',
      benutzername: 'admin',
      aktiv: true,
      erstellt_at: '',
      totp_aktiviert: false,
    },
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
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

  // Der Knopf VERSCHWINDET seit LFH-345/C10 nicht mehr — er steht gesperrt da, mit Grund (M16).
  it('ist read-only für Nicht-Admins (fuehrungskraft): Speichern-Button gesperrt, Feld disabled', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: {
        id: 2,
        system_rolle: 'keiner',
        org_rolle: 'fuehrungskraft',
        anzeigename: 'FK',
        benutzername: 'fk',
        aktiv: true,
        erstellt_at: '',
        totp_aktiviert: false,
      },
      laedt: false,
      login: vi.fn(),
      logout: vi.fn(),
      aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<AnzeigeEinstellungen />);

    await screen.findByText('Anzeige-Konventionen');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByLabelText(/Geocoder-URL/i)).toBeDisabled();
  });
});

/**
 * Persistenter Speicherfehler und erklärte Berechtigung (LFH-345 · C10, Befunde H14/M16).
 * Warum die vom AK verlangte Fake-Timer-Form hier fehlt, steht ausführlich (und
 * mutationsgeprüft) im Kopfkommentar von `EinsatzDefaults.test.tsx` — kurz: sie kann in
 * dieser Umgebung nicht rot werden.
 */
describe('AnzeigeEinstellungen · Speicherfehler und Berechtigung (LFH-345)', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
  });

  it('meldet den Fehler an der Seite, NICHT als Toast', async () => {
    vi.mocked(speichereOrgEinstellungen).mockRejectedValue(new ApiError(422, 'Zeitzone unbekannt'));
    renderMitProviders(<AnzeigeEinstellungen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    const treffer = await screen.findByText('Zeitzone unbekannt');
    expect(treffer.closest('.ant-message')).toBeNull();
  });

  it('raeumt den Fehler beim naechsten Absenden weg', async () => {
    vi.mocked(speichereOrgEinstellungen)
      .mockRejectedValueOnce(new ApiError(422, 'Zeitzone unbekannt'))
      .mockResolvedValue({ ...VOLL } as never);
    renderMitProviders(<AnzeigeEinstellungen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await screen.findByText('Zeitzone unbekannt');

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByText('Zeitzone unbekannt')).not.toBeInTheDocument());
  });

  it('erklaert der Fuehrungskraft den Grund UND laesst den Knopf stehen', async () => {
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(useAuth).mockReturnValue({
      benutzer: {
        id: 2,
        system_rolle: 'keiner',
        org_rolle: 'fuehrungskraft',
        anzeigename: 'FK',
        benutzername: 'fk',
        aktiv: true,
        erstellt_at: '',
        totp_aktiviert: false,
      },
      laedt: false,
      login: vi.fn(),
      logout: vi.fn(),
      aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<AnzeigeEinstellungen />);

    expect(await screen.findByText(/Nur Benutzer mit der Systemrolle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('schweigt ueber Berechtigungen, wenn welche da sind', async () => {
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    renderMitProviders(<AnzeigeEinstellungen />);

    await screen.findByText('Anzeige-Konventionen');
    expect(screen.queryByText(/Nur Benutzer mit der Systemrolle/)).not.toBeInTheDocument();
  });
});
