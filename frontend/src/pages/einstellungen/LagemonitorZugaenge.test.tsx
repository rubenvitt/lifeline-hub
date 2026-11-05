import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { waehleMenueEintrag } from '../../test/menue';
import LagemonitorZugaenge, { zugangZustand } from './LagemonitorZugaenge';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Verwaltung der Lesezugänge externer Lagemonitore (LLH-1484). */

const zugang = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  bezeichnung: `FüKW ${id}`,
  angelegt_at: '2026-11-05 08:00:00',
  angelegt_von_name: 'Ada Admin',
  ...extra,
});

function stelleBereit(
  liste: unknown[] = [zugang(1, { einsatz_id: 4, einsatz_bezeichnung: 'Hochwasser' })],
) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  server.use(
    http.get('/api/lagemonitor-zugaenge', () => HttpResponse.json(liste)),
    http.post('/api/lagemonitor-zugaenge', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'anlegen', body });
      return HttpResponse.json(
        { zugang: zugang(2, { bezeichnung: body.bezeichnung }), schluessel: 'llh_lm_GEHEIM' },
        { status: 201 },
      );
    }),
    http.post('/api/lagemonitor-zugaenge/1/widerrufen', () => {
      aufrufe.push({ pfad: 'widerrufen', body: null });
      return HttpResponse.json(zugang(1, { widerrufen_at: '2026-11-05 09:00:00' }));
    }),
  );
  return aufrufe;
}

describe('LagemonitorZugaenge (LLH-1484)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('nennt je Zugang den gezeigten Einsatz', async () => {
    stelleBereit();
    renderMitProviders(<LagemonitorZugaenge />);
    expect(await screen.findByText('FüKW 1')).toBeInTheDocument();
    expect(screen.getByText(/zeigt Hochwasser/)).toBeInTheDocument();
  });

  it('legt einen Zugang an und zeigt den Schlüssel einmal', async () => {
    const aufrufe = stelleBereit([]);
    const user = userEvent.setup();
    renderMitProviders(<LagemonitorZugaenge />);
    await screen.findByText('Noch kein Lagemonitor');
    await user.click(screen.getByRole('button', { name: /Zugang anlegen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Lagemonitor anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Bezeichnung' }), 'FüKW Monitor');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([{ pfad: 'anlegen', body: { bezeichnung: 'FüKW Monitor' } }]),
    );
    const text = await screen.findByText('llh_lm_GEHEIM');
    const dialog2 = text.closest<HTMLElement>('[data-lfh="lagemonitor-schluessel"]')!;
    expect(dialog2.textContent).toMatch(/Nur jetzt sichtbar\./);
    expect(dialog2.textContent).toMatch(/\/api\/lagemonitor\/v1\/lage/);
  });

  it('widerruft erst nach Rückfrage', async () => {
    const aufrufe = stelleBereit();
    renderMitProviders(<LagemonitorZugaenge />);
    await screen.findByText('FüKW 1');
    await waehleMenueEintrag(
      screen.getByRole('button', { name: 'Aktionen zu Lagemonitor FüKW 1' }),
      /Widerrufen/,
    );
    const dialog = await screen.findByRole('dialog', { name: 'FüKW 1 widerrufen?' });
    expect(aufrufe).toEqual([]);
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: 'widerrufen', body: null }]));
  });

  it('lässt ohne System-Admin nur lesen', async () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    stelleBereit();
    renderMitProviders(<LagemonitorZugaenge />);
    await screen.findByText('FüKW 1');
    expect(screen.queryByRole('button', { name: /Zugang anlegen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktionen zu/ })).not.toBeInTheDocument();
  });

  it('beschreibt Widerruf und fehlende Nutzung als Wort', () => {
    const zeit = (w: string) => w.slice(11, 16);
    expect(zugangZustand(zugang(1, { widerrufen_at: '2026-11-05 09:00:00' }), zeit)).toBe(
      'widerrufen 09:00 · noch nie abgerufen · angelegt von Ada Admin',
    );
    expect(zugangZustand(zugang(1, { zuletzt_genutzt_at: '2026-11-05 09:05:00' }), zeit)).toBe(
      'kein Einsatz freigegeben · zuletzt 09:05 · angelegt von Ada Admin',
    );
  });
});
