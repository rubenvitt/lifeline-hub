import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../test/utils';
import KartenOnlineSektion from './KartenOnlineSektion';
import KartenOfflineSektion from './KartenOfflineSektion';

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));
// Kind-Komponenten haben eigene Tests — hier nur der Sektions-Rahmen.
vi.mock('./OnlineQuellenVerwaltung', () => ({ default: () => <div>online-kind</div> }));
vi.mock('./OfflineKartenVerwaltung', () => ({ default: () => <div>offline-kind</div> }));

import { useAuth } from '../auth/AuthContext';

function setzeRolle(system_rolle: string, org_rolle = 'keine') {
  vi.mocked(useAuth).mockReturnValue({
    benutzer: {
      id: 1,
      system_rolle,
      org_rolle,
      anzeigename: 'X',
      benutzername: 'x',
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

describe('KartenOnlineSektion', () => {
  beforeEach(() => setzeRolle('admin'));

  it('rendert Titel + Kind, kein read-only-Alert für Admin', () => {
    renderMitProviders(<KartenOnlineSektion />);
    expect(screen.getByRole('heading', { name: 'Online-Quellen' })).toBeInTheDocument();
    expect(screen.getByText('online-kind')).toBeInTheDocument();
    expect(screen.queryByText('Nur lesend')).not.toBeInTheDocument();
  });

  it('zeigt read-only-Alert für Nicht-Admin (fuehrungskraft)', () => {
    setzeRolle('keiner', 'fuehrungskraft');
    renderMitProviders(<KartenOnlineSektion />);
    expect(screen.getByText('Nur lesend')).toBeInTheDocument();
    expect(screen.getByText('online-kind')).toBeInTheDocument();
  });
});

describe('KartenOfflineSektion', () => {
  beforeEach(() => setzeRolle('admin'));

  it('rendert Titel + Kind', () => {
    renderMitProviders(<KartenOfflineSektion />);
    expect(screen.getByRole('heading', { name: 'Offline-Karten' })).toBeInTheDocument();
    expect(screen.getByText('offline-kind')).toBeInTheDocument();
  });
});
