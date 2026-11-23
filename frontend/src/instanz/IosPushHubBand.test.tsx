import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import IosPushHubBand from './IosPushHubBand';
import type { EinsatzAnzeige, IosPushHubSperre } from '../api/types';

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../test/fixtures';

const NORD: IosPushHubSperre = { hub_name: 'Hub Nord', since: '2026-11-23 08:15:00' };

const einsatz = (
  rolle: EinsatzAnzeige['meine_rolle'],
  sperren?: IosPushHubSperre[],
): EinsatzAnzeige =>
  ({
    id: 7,
    org_id: 1,
    status: 'aktiv',
    meine_rolle: rolle,
    ios_push_hub_gesperrt: sperren,
  }) as EinsatzAnzeige;

const TITEL = 'iOS-Push über den Hub „Hub Nord“ wird nicht zugestellt';

describe('IosPushHubBand (LLH-2074)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
  });

  it('die Einsatzleitung sieht die Sperre mit Folge und Handgriff', () => {
    renderMitProviders(<IosPushHubBand einsatz={einsatz('einsatzleitung', [NORD])} />);
    expect(screen.getByText(TITEL)).toBeInTheDocument();
    expect(screen.getByText(/Alarme erreichen iPhones von Hub-Konten nicht/)).toBeInTheDocument();
    expect(screen.getByText(/Wichtiges auf anderem Weg absichern/)).toBeInTheDocument();
  });

  it('der Admin der Einsatz-Org sieht sie auch ohne Rolle im Einsatz', () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture({ org_id: 1 })));
    renderMitProviders(<IosPushHubBand einsatz={einsatz(null, [NORD])} />);
    expect(screen.getByText(TITEL)).toBeInTheDocument();
  });

  it('Führungspersonal und der Admin einer anderen Org sehen nichts', () => {
    const { unmount } = renderMitProviders(
      <IosPushHubBand einsatz={einsatz('fuehrungspersonal', [NORD])} />,
    );
    expect(screen.queryByText(TITEL)).toBeNull();
    unmount();
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture({ org_id: 2 })));
    renderMitProviders(<IosPushHubBand einsatz={einsatz(null, [NORD])} />);
    expect(screen.queryByText(TITEL)).toBeNull();
  });

  it('ohne gesperrten Hub kein Band', () => {
    const { container } = renderMitProviders(
      <IosPushHubBand einsatz={einsatz('einsatzleitung')} />,
    );
    expect(container.querySelector('[data-lfh="ios-push-hub-band"]')).toBeNull();
  });

  it('nennt jeden gesperrten Hub', () => {
    renderMitProviders(
      <IosPushHubBand
        einsatz={einsatz('einsatzleitung', [NORD, { hub_name: 'Hub Süd', since: NORD.since }])}
      />,
    );
    expect(screen.getByText(TITEL)).toBeInTheDocument();
    expect(
      screen.getByText('iOS-Push über den Hub „Hub Süd“ wird nicht zugestellt'),
    ).toBeInTheDocument();
  });
});
