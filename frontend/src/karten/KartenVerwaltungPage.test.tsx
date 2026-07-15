import { screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../test/utils';

// useAuth steuert das read-only-Gating; die Kind-Verwaltungen sind eigenständig getestet
// und hier gestubbt, damit der Seitentest auf Rahmen/Gating/Segmented fokussiert bleibt.
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./OnlineQuellenVerwaltung', () => ({ default: () => <div>OnlineStub</div> }));
vi.mock('./OfflineKartenVerwaltung', () => ({ default: () => <div>OfflineStub</div> }));

import { useAuth } from '../auth/AuthContext';
import KartenVerwaltungPage from './KartenVerwaltungPage';

function setzeRolle(system_rolle: 'admin' | 'keiner') {
  vi.mocked(useAuth).mockReturnValue({
    benutzer: { id: 1, anzeigename: 'X', benutzername: 'x', system_rolle, org_rolle: 'keine', aktiv: true, erstellt_at: '', totp_aktiviert: false },
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
  });
}

describe('KartenVerwaltungPage', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
  });

  it('rendert den Rahmen und zeigt Admins KEIN "Nur lesend"-Banner', () => {
    setzeRolle('admin');
    renderMitProviders(<KartenVerwaltungPage />);
    expect(screen.getByRole('heading', { name: 'Karten-Verwaltung' })).toBeInTheDocument();
    expect(screen.queryByText('Nur lesend')).not.toBeInTheDocument();
  });

  it('zeigt Nicht-Admins das "Nur lesend"-Banner', () => {
    setzeRolle('keiner');
    renderMitProviders(<KartenVerwaltungPage />);
    expect(screen.getByText('Nur lesend')).toBeInTheDocument();
  });

  it('hält beide Sektionen gemountet und schaltet per Segmented um', async () => {
    setzeRolle('admin');
    renderMitProviders(<KartenVerwaltungPage />);
    // Beide Panels gemountet (Constraint f: Download-Polling darf beim Wechsel nicht abreißen).
    expect(screen.getByText('OnlineStub')).toBeInTheDocument();
    expect(screen.getByText('OfflineStub')).toBeInTheDocument();
    expect(screen.getByText('OnlineStub')).toBeVisible();
    expect(screen.getByText('OfflineStub')).not.toBeVisible();

    fireEvent.click(await screen.findByRole('radio', { name: 'Offline-Karten' }));
    expect(screen.getByText('OfflineStub')).toBeVisible();
    expect(screen.getByText('OnlineStub')).not.toBeVisible();
  });
});
