import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { globalKeys } from '../api/queryKeys';
import { ApiError } from '../api/client';
import { PANEEL_FEHLER_TITEL, PANEEL_NEULADEN } from '../components/instrument/PaneelZustand';
import { EinsaetzeBeimGegenueber, fremdeNachladenAlle } from './EinsaetzeBeimGegenueber';
import type { FuehrungAnzeige } from '../api/types';

vi.mock('../api/fuehrung', () => ({
  loadFuehrungFremd: vi.fn(),
  frageFuehrungAn: vi.fn(),
  uebernimmFuehrung: vi.fn(),
}));

import { frageFuehrungAn, loadFuehrungFremd, uebernimmFuehrung } from '../api/fuehrung';

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
  anfrage_abgelehnt: false,
  verwahrt: false,
  gegenueber: [
    {
      kopplung_id: 1,
      kennung: 'k-hub',
      name: 'Hub Nord',
      richtung: 'meldet_sich',
      art: 'standard',
      wechsel: 'nach_richtung',
    },
  ],
  fuehrer_richtung: 'meldet_sich',
  verlauf: [],
};

describe('Einsätze beim Gegenüber (LLH-1491)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listet die Akten mit Führung und öffnet die Bedienung', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockResolvedValue({ ...akte, anfrage_offen: true });
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('E2026-0003 Stadtfest')).toBeInTheDocument();
    expect(screen.getByText('Führung: Hub Nord · Epoche 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    expect(frageFuehrungAn).toHaveBeenCalledWith({ akteId: 4, kennung: 'k-hub/3' });
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
  // Abschnitt fehlte sonst wortlos. LLH-1861: im Bild von „Führung“ auf „Einsatzdaten“
  // (`PaneelZustand`).
  it('ein anderer Ladefehler steht als PaneelZustand mit „Erneut abrufen“ im Abschnitt', async () => {
    vi.mocked(loadFuehrungFremd)
      .mockRejectedValueOnce(new ApiError(500, 'Interner Fehler', { vomAnwendungsserver: true }))
      .mockResolvedValueOnce([akte]);
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />);
    expect(await screen.findByText('Einsätze beim Gegenüber')).toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-lfh', 'paneel-fehler');
    expect(within(alert).getByText(PANEEL_FEHLER_TITEL)).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: PANEEL_NEULADEN }));
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
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-lfh', 'paneel-fehler');
    expect(within(alert).getByText(PANEEL_FEHLER_TITEL)).toBeInTheDocument();
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
    // Ein 403 ohne Umschlag kommt von einem Proxy oder einer WAF, nicht vom Recht der Person.
    expect(fremdeNachladenAlle(new ApiError(403, 'Forbidden'))).toBe(30_000);
    expect(fremdeNachladenAlle(new ApiError(500, 'Interner Fehler'))).toBe(30_000);
    expect(fremdeNachladenAlle(new TypeError('Failed to fetch'))).toBe(30_000);
    expect(fremdeNachladenAlle(null)).toBe(30_000);
  });

  it('fällt die Akte beim Abruf aus der Liste, bleibt der Dialog mit Hinweis stehen (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Nicht mehr unter/)).toBeNull();
    vi.mocked(loadFuehrungFremd).mockResolvedValue([]);
    await client.invalidateQueries({ queryKey: globalKeys.instanzkopplungFuehrung() });
    expect(await screen.findByText('Kein Einsatz beim Gegenüber')).toBeInTheDocument();
    const nochDa = screen.getByRole('dialog');
    expect(
      within(nochDa).getByText(/Nicht mehr unter „Einsätze beim Gegenüber“/),
    ).toBeInTheDocument();
    expect(within(nochDa).getByRole('button', { name: 'Führung anfragen' })).toBeEnabled();
  });

  // LLH-1862: SQLite vergibt die ID einer gelöschten Akte neu. Eine andere Akte unter derselben ID
  // ist nicht die gewählte: Der Dialog bleibt beim gezeigten Einsatz, mit Hinweis, und die
  // Anfrage nennt dessen Kennung.
  it('liegt unter der ID ein anderer Einsatz, bleibt der Dialog beim gezeigten (LLH-1862)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockRejectedValue(
      new ApiError(409, 'Unter dieser Akte liegt inzwischen ein anderer Einsatz.', {
        vomAnwendungsserver: true,
      }),
    );
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    await screen.findByRole('dialog');
    vi.mocked(loadFuehrungFremd).mockResolvedValue([
      { ...akte, kennung: 'k-hub/9', nummer: 'E2026-0009', bezeichnung: 'Hochwasser' },
    ]);
    await client.invalidateQueries({ queryKey: globalKeys.instanzkopplungFuehrung() });
    expect(await screen.findByText('E2026-0009 Hochwasser')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Stadtfest')).toBeInTheDocument();
    expect(within(dialog).queryByText('Hochwasser')).toBeNull();
    expect(
      within(dialog).getByText(/Nicht mehr unter „Einsätze beim Gegenüber“/),
    ).toBeInTheDocument();
    const abrufeVorher = vi.mocked(loadFuehrungFremd).mock.calls.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    expect(frageFuehrungAn).toHaveBeenCalledWith({ akteId: 4, kennung: 'k-hub/3' });
    expect(
      await within(dialog).findByText(/Unter dieser Akte liegt inzwischen ein anderer Einsatz/),
    ).toBeInTheDocument();
    // Die 409 lädt die Liste gleich neu, nicht erst mit dem nächsten 30-s-Abruf: Wer die Zeile
    // erneut wählt, bekommt den Einsatz, der jetzt unter der ID liegt.
    await waitFor(() =>
      expect(vi.mocked(loadFuehrungFremd).mock.calls.length).toBeGreaterThan(abrufeVorher),
    );
  });

  it('ein neuer Stand aus der Liste erreicht den offenen Dialog (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Führung anfragen' })).toBeInTheDocument();
    vi.mocked(loadFuehrungFremd).mockResolvedValue([{ ...akte, anfrage_offen: true }]);
    await client.invalidateQueries({ queryKey: globalKeys.instanzkopplungFuehrung() });
    expect(await within(dialog).findByText('beim Gegenüber gestellt')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Führung anfragen' })).toBeNull();
  });

  it('nimmt die eigene Aktion die Akte aus der Liste, zeigt der Dialog die Antwort des Servers (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockResolvedValue({ ...akte, anfrage_offen: true });
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    vi.mocked(loadFuehrungFremd).mockResolvedValue([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    expect(await screen.findByText('Kein Einsatz beim Gegenüber')).toBeInTheDocument();
    const nochDa = screen.getByRole('dialog');
    expect(within(nochDa).getByText(/Nicht mehr unter/)).toBeInTheDocument();
    expect(within(nochDa).getByText('beim Gegenüber gestellt')).toBeInTheDocument();
    expect(within(nochDa).queryByRole('button', { name: 'Führung anfragen' })).toBeNull();
  });

  it('nach der eigenen Notübernahme zeigt der Dialog die Führung hier, ohne zweite Notübernahme (LLH-1670)', async () => {
    // Ein Einsatz, der hier als Spiegel liegt: die Notübernahme löscht den Spiegel, die Akte
    // fällt danach aus der Liste.
    const spiegel = { ...akte, einsatz_id: 12 };
    vi.mocked(loadFuehrungFremd).mockResolvedValue([spiegel]);
    vi.mocked(uebernimmFuehrung).mockImplementation(async () => {
      vi.mocked(loadFuehrungFremd).mockResolvedValue([]);
      return {
        ...spiegel,
        fuehrend: true,
        fuehrer_name: 'ELW 1',
        fuehrer_kennung: 'k-elw',
        epoche: 2,
        art: 'notuebernahme',
      };
    });
    const client = neuerQueryClient();
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Notübernahme …' }));
    const not = await screen.findByRole('dialog', { name: 'Notübernahme gegen Hub Nord' });
    await userEvent.type(within(not).getByLabelText('Grund'), 'Hub weg');
    await userEvent.click(within(not).getByRole('button', { name: 'Führung übernehmen' }));
    expect(await screen.findByText('Kein Einsatz beim Gegenüber')).toBeInTheDocument();
    expect(within(dialog).getByText(/Nicht mehr unter/)).toBeInTheDocument();
    expect(within(dialog).getByText('hier')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Notübernahme …' })).toBeNull();
  });

  it('scheitert der Abruf nach der eigenen Aktion, gilt die Antwort des Servers (LLH-1670)', async () => {
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockImplementation(async () => {
      vi.mocked(loadFuehrungFremd).mockRejectedValue(new Error('Server weg'));
      return { ...akte, anfrage_offen: true };
    });
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client: neuerQueryClient() });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    await waitFor(() => expect(loadFuehrungFremd).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText('beim Gegenüber gestellt')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Führung anfragen' })).toBeNull();
  });

  it('solange eine Aktion läuft, lässt sich der Dialog nicht schließen (LLH-1670)', async () => {
    let fertig: (f: FuehrungAnzeige) => void = () => {};
    vi.mocked(loadFuehrungFremd).mockResolvedValue([akte]);
    vi.mocked(frageFuehrungAn).mockReturnValue(new Promise((r) => (fertig = r)));
    renderMitProviders(<EinsaetzeBeimGegenueber darfBedienen />, { client: neuerQueryClient() });
    await userEvent.click(await screen.findByRole('button', { name: 'Führung …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung anfragen' }));
    const kreuz = within(dialog).getByRole('button', { name: 'Close' });
    expect(kreuz).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    // In jsdom endet keine Animation: „geschlossen“ zeigt sich an der beginnenden Schließ-Animation.
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave');
    fertig({ ...akte, anfrage_offen: true });
    await waitFor(() => expect(kreuz).toBeEnabled());
  });
});
