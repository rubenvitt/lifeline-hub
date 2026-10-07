import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { authWertFixture, benutzerFixture } from '../test/fixtures';
import type { OrgRolle, SystemRolle } from '../api/types';
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

function setzeRolle(system_rolle: SystemRolle, org_rolle: OrgRolle = 'keine') {
  vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture({ system_rolle, org_rolle })));
}

describe('KartenOnlineSektion', () => {
  beforeEach(() => setzeRolle('admin'));

  it('rendert Titel + Kind, keine Rechtezeile für Admin', () => {
    renderMitProviders(<KartenOnlineSektion />);
    expect(screen.getByRole('heading', { name: 'Online-Quellen' })).toBeInTheDocument();
    expect(screen.getByText('online-kind')).toBeInTheDocument();
    expect(screen.queryByText('Nur Ansicht')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Basemap/);
  });

  /** LFH-1078: Titel und Liste reichen — kein Zweck-Absatz, kein Satz über den Status „aktiv“. */
  it('erklärt nichts: keine Beschreibung, kein Absatz', () => {
    renderMitProviders(<KartenOnlineSektion />);
    expect(screen.queryByText(/Kartengrundlage/)).not.toBeInTheDocument();
    expect(screen.queryByText(/erscheinen/)).not.toBeInTheDocument();
  });

  it('Nicht-Admin: „Nur Ansicht · nur System-Admin“ statt Info-Kasten', () => {
    setzeRolle('keiner', 'fuehrungskraft');
    renderMitProviders(<KartenOnlineSektion />);
    const zeile = screen.getByRole('status');
    expect(zeile).toHaveTextContent('Nur Ansicht');
    expect(zeile).toHaveTextContent('nur System-Admin');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
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

  /** LFH-1078: Titel und Liste reichen — kein Absatz über MBTiles, Prep-Phase und Auslieferung. */
  it('erklärt nichts: keine Beschreibung, kein Absatz', () => {
    renderMitProviders(<KartenOfflineSektion />);
    expect(screen.queryByText(/MBTiles/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Prep-Phase/)).not.toBeInTheDocument();
    expect(screen.queryByText('Nur Ansicht')).not.toBeInTheDocument();
  });

  it('Nicht-Admin: „Nur Ansicht · nur System-Admin“ statt Info-Kasten', () => {
    setzeRolle('keiner', 'fuehrungskraft');
    renderMitProviders(<KartenOfflineSektion />);
    const zeile = screen.getByRole('status');
    expect(zeile).toHaveTextContent('Nur Ansicht');
    expect(zeile).toHaveTextContent('nur System-Admin');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
    expect(screen.getByText('offline-kind')).toBeInTheDocument();
  });
});
