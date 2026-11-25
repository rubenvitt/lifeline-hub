import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import OrtungHauptamt from './OrtungHauptamt';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Org-Schalter „Ortung auch bei hauptamtlicher Besatzung“ (LLH-2091). */

const TEXT = 'Ortung auch bei hauptamtlicher Besatzung';
const ZEILE = 'Nur mit Betriebs- oder Dienstvereinbarung (§ 87 Abs. 1 Nr. 6 BetrVG).';

function stelleBereit(ortung: number | null) {
  const puts: Record<string, unknown>[] = [];
  let stand = {
    org_id: 1,
    zeitzone: 'Europe/Berlin',
    zeitdarstellung: null,
    einheiten: null,
    koordinatenformat: null,
    retention_dauer_tage: 30,
    skelett_dauer_tage: null,
    etb_nummer_praefix: 'E',
    meldung_nummer_praefix: null,
    auftrag_nummer_praefix: null,
    einsatz_nummer_praefix: null,
    meldung_bestaetigung_frist_min: 15,
    auftrag_quittierung_frist_min: null,
    rueckmeldung_frist_min: null,
    auto_etb_eintraege: 0,
    ortung_hauptamt: ortung,
    geocoder_url: null,
    aufbewahrung_kategorien: [],
  } as Record<string, unknown>;
  server.use(
    http.get('/api/org-settings', () => HttpResponse.json(stand)),
    http.put('/api/org-settings', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      puts.push(body);
      stand = { ...stand, ortung_hauptamt: body.ortung_hauptamt ? 1 : 0 };
      return HttpResponse.json(stand);
    }),
  );
  return puts;
}

describe('OrtungHauptamt', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('zeigt den Schalter mit Text und Zustandszeile', async () => {
    stelleBereit(null);
    renderMitProviders(<OrtungHauptamt />);
    const schalter = await screen.findByRole('switch', { name: TEXT });
    expect(schalter).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(ZEILE)).toBeInTheDocument();
  });

  it('speichert sofort und schickt die übrigen Einstellungen unverändert mit', async () => {
    const puts = stelleBereit(null);
    renderMitProviders(<OrtungHauptamt />);
    await userEvent.click(await screen.findByRole('switch', { name: TEXT }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      ortung_hauptamt: true,
      zeitzone: 'Europe/Berlin',
      retention_dauer_tage: 30,
      etb_nummer_praefix: 'E',
      meldung_bestaetigung_frist_min: 15,
      auto_etb_eintraege: false,
    });
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: TEXT })).toHaveAttribute('aria-checked', 'true'),
    );
  });

  it('schaltet wieder aus', async () => {
    const puts = stelleBereit(1);
    renderMitProviders(<OrtungHauptamt />);
    const schalter = await screen.findByRole('switch', { name: TEXT });
    expect(schalter).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(schalter);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ ortung_hauptamt: false });
  });

  it('ist ohne Admin-Recht nicht bedienbar', async () => {
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ system_rolle: 'keiner' })),
    );
    stelleBereit(null);
    renderMitProviders(<OrtungHauptamt />);
    expect(await screen.findByRole('switch', { name: TEXT })).toBeDisabled();
  });
});
