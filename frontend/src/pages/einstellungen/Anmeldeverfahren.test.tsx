import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import Anmeldeverfahren from './Anmeldeverfahren';

vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/auth', () => ({
  providerListeAdmin: vi.fn(),
  providerSchalten: vi.fn(),
}));

import { useAuth } from '../../auth/AuthContext';
import { providerListeAdmin, providerSchalten } from '../../api/auth';
import { ApiError } from '../../api/client';

const PROVIDER_LISTE = [
  { id: 'passwort', typ: 'passwort' as const, anzeigename: 'Passwort', aktiviert: true },
  { id: 'oidc', typ: 'oidc' as const, anzeigename: 'PocketID', aktiviert: true },
  { id: 'webauthn', typ: 'webauthn' as const, anzeigename: 'Passkey', aktiviert: false },
];

function alsAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    benutzer: { id: 1, system_rolle: 'admin', org_rolle: 'keine', anzeigename: 'Admin', benutzername: 'admin', aktiv: true, erstellt_at: '', totp_aktiviert: false },
    laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
  } as never);
}

describe('Anmeldeverfahren', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(providerListeAdmin).mockResolvedValue(PROVIDER_LISTE.map((p) => ({ ...p })) as never);
    vi.mocked(providerSchalten).mockResolvedValue(
      PROVIDER_LISTE.map((p) => (p.id === 'oidc' ? { ...p, aktiviert: false } : { ...p })) as never,
    );
  });

  it('listet die konfigurierten Auth-Provider', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    expect(await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Anmeldeverfahren: Passwort' })).toBeInTheDocument();
  });

  it('zeigt auch deaktivierte Provider (Admin-Endpoint, LFH-277)', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    const passkey = await screen.findByRole('switch', { name: 'Anmeldeverfahren: Passkey' });
    expect(passkey).not.toBeChecked();
    expect(passkey).not.toBeDisabled();
  });

  it('schaltet einen Provider per PUT um und aktualisiert die Anzeige', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    const oidc = await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });
    expect(oidc).toBeChecked();

    await userEvent.click(oidc);

    await waitFor(() => expect(providerSchalten).toHaveBeenCalledWith('oidc', false));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Anmeldeverfahren: PocketID' })).not.toBeChecked(),
    );
  });

  it('sperrt den passwort-Provider (garantierter Admin-Weg)', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    expect(await screen.findByRole('switch', { name: 'Anmeldeverfahren: Passwort' })).toBeDisabled();
  });

  it('zeigt eine Fehlermeldung, wenn der Server ablehnt (409)', async () => {
    const meldung = 'Der letzte admin-taugliche Login-Weg kann nicht deaktiviert werden';
    vi.mocked(providerSchalten).mockRejectedValue(new ApiError(409, meldung));

    renderMitProviders(<Anmeldeverfahren />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }));

    expect(await screen.findByText(meldung)).toBeInTheDocument();
  });

  it('ist read-only für Nicht-Admins (fuehrungskraft)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 2, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'FK', benutzername: 'fk', aktiv: true, erstellt_at: '', totp_aktiviert: false },
      laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<Anmeldeverfahren />);
    expect(await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' })).toBeDisabled();
  });
});
