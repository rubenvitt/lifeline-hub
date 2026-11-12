import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { EinsaetzeBeimGegenueber, fremdeNachladenAlle } from './EinsaetzeBeimGegenueber';
import { ApiError } from '../api/client';
import type { FuehrungAnzeige } from '../api/types';

vi.mock('../api/fuehrung', () => ({
  loadFuehrungFremd: vi.fn(),
  frageFuehrungAn: vi.fn(),
  uebernimmFuehrung: vi.fn(),
}));

import { frageFuehrungAn, loadFuehrungFremd } from '../api/fuehrung';

const akte: FuehrungAnzeige = {
  id: 4,
  kennung: 'k-hub/3',
  nummer: 'E2026-0003',
  bezeichnung: 'Stadtfest',
  status: 'aktiv',
  epoche: 1,
  fuehrer_name: 'Hub Nord',
  fuehrer_kennung: 'k-hub',
  fuehrend: false,
  art: 'angelegt',
  anfrage_offen: false,
  verwahrt: false,
  gegenueber: [{ kopplung_id: 1, kennung: 'k-hub', name: 'Hub Nord', richtung: 'meldet_sich' }],
  fuehrer_richtung: 'meldet_sich',
  verlauf: [],
};

describe('Einsätze beim Gegenüber (LLH-1491)', () => {
  it('listet die Akten mit Führung und öffnet die Bedienung', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockResolvedValue({ ...akte, anfrage_offen: true });
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('E2026-0003 Stadtfest')).toBeInTheDocument();
    expect(screen.getByText('Führung: Hub Nord · Epoche 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    expect(frageFuehrungAn).toHaveBeenCalledWith({ akteId: 4 });
  });

  it('ohne Schalter (404) fehlt der Abschnitt', async () => {
    vi.mocked(loadFuehrungFremd).mockRejectedValue(
      new ApiError(404, 'Nicht gefunden', { vomAnwendungsserver: true }),
    );
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Einsätze beim Gegenüber')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // LLH-1675: Ein Server- oder Leitungsfehler ist nicht der gewollte 404 bei Schalter aus; der
  // Abschnitt fehlte sonst wortlos.
  it('ein anderer Ladefehler steht mit „Erneut laden“ im Abschnitt', async () => {
    vi.mocked(loadFuehrungFremd)
      .mockRejectedValueOnce(new ApiError(500, 'Interner Fehler', { vomAnwendungsserver: true }))
      .mockResolvedValueOnce([akte]);
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('Einsätze beim Gegenüber')).toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Akten des Gegenübers nicht abrufbar')).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Erneut laden' }));
    expect(await screen.findByText('E2026-0003 Stadtfest')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Review LLH-1675: Eine Führungskraft ohne System-Admin liest die Seite, der Server antwortet ihr
  // 403. Das ist kein Ladefehler; der Abschnitt fehlt wie vor der Änderung.
  it('ohne Admin-Recht (403) fehlt der Abschnitt ohne Fehler', async () => {
    vi.mocked(loadFuehrungFremd).mockRejectedValue(
      new ApiError(403, 'Keine Berechtigung', { vomAnwendungsserver: true }),
    );
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Einsätze beim Gegenüber')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Ein 404 ohne `{error}`-Umschlag kommt von einem vorgeschalteten Gateway, nicht vom Schalter.
  it('ein 404 vom Gateway ist ein Ladefehler', async () => {
    vi.mocked(loadFuehrungFremd).mockRejectedValue(new ApiError(404, 'Not Found'));
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('Akten des Gegenübers nicht abrufbar')).toBeInTheDocument();
  });

  it('scheitert ein Neuabruf, bleibt die Liste mit dem Hinweis auf den veralteten Stand', async () => {
    vi.mocked(loadFuehrungFremd)
      .mockResolvedValueOnce([akte])
      .mockRejectedValueOnce(new ApiError(500, 'Interner Fehler', { vomAnwendungsserver: true }))
      .mockResolvedValueOnce([akte]);
    const { client } = renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('E2026-0003 Stadtfest')).toBeInTheDocument();
    await act(() => client.refetchQueries());
    expect(
      await screen.findByText('Aktualisierung fehlgeschlagen · Stand womöglich veraltet'),
    ).toBeInTheDocument();
    expect(screen.getByText('E2026-0003 Stadtfest')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Aktualisierung fehlgeschlagen · Stand womöglich veraltet'),
      ).toBeNull(),
    );
  });

  it('wird der Schalter nach dem Laden abgeschaltet (404), fehlt der Abschnitt', async () => {
    vi.mocked(loadFuehrungFremd)
      .mockResolvedValueOnce([akte])
      .mockRejectedValueOnce(new ApiError(404, 'Nicht gefunden', { vomAnwendungsserver: true }));
    const { client } = renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('E2026-0003 Stadtfest')).toBeInTheDocument();
    await act(() => client.refetchQueries());
    await waitFor(() => expect(screen.queryByText('Einsätze beim Gegenüber')).toBeNull());
  });

  it('fragt bei 404 und 403 nicht mehr nach, bei anderen Fehlern weiter alle 30 s', () => {
    const vomServer = { vomAnwendungsserver: true };
    expect(fremdeNachladenAlle(new ApiError(404, 'Nicht gefunden', vomServer))).toBe(false);
    expect(fremdeNachladenAlle(new ApiError(403, 'Keine Berechtigung', vomServer))).toBe(false);
    expect(fremdeNachladenAlle(new ApiError(404, 'Not Found'))).toBe(30_000);
    expect(fremdeNachladenAlle(new ApiError(500, 'Interner Fehler'))).toBe(30_000);
    expect(fremdeNachladenAlle(new TypeError('Failed to fetch'))).toBe(30_000);
    expect(fremdeNachladenAlle(null)).toBe(30_000);
  });
});
