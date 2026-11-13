import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { renderMitProviders, setzeOnline } from '../test/utils';
import FuehrungPaneel from './FuehrungPaneel';
import type { FuehrungAnzeige } from '../api/types';
import { FUEHRUNG_GRUND_MAX } from '../api/eingabegrenzen';
import { ApiError } from '../api/client';

vi.mock('../api/fuehrung', () => ({
  bestaetigeUebernahme: vi.fn(),
  frageFuehrungAn: vi.fn(),
  gibFuehrungPerCodeAb: vi.fn(),
  holeFuehrungZurueck: vi.fn(),
  uebergebeFuehrung: vi.fn(),
  uebernimmFuehrung: vi.fn(),
  uebernimmFuehrungMitCode: vi.fn(),
  uebernimmFuehrungMitUnterschrift: vi.fn(),
  widersprecheUebernahme: vi.fn(),
}));

import {
  bestaetigeUebernahme,
  frageFuehrungAn,
  gibFuehrungPerCodeAb,
  holeFuehrungZurueck,
  uebergebeFuehrung,
  uebernimmFuehrung,
  uebernimmFuehrungMitCode,
  uebernimmFuehrungMitUnterschrift,
  widersprecheUebernahme,
} from '../api/fuehrung';

const akte = (teil: Partial<FuehrungAnzeige> = {}): FuehrungAnzeige => ({
  id: 4,
  kennung: 'k-elw/7',
  einsatz_id: 7,
  bezeichnung: 'Hochwasser',
  status: 'aktiv',
  epoche: 1,
  fuehrer_name: 'ELW 1',
  fuehrer_kennung: 'k-elw',
  fuehrend: true,
  art: 'angelegt',
  anfrage_offen: false,
  verwahrt: false,
  gegenueber: [
    {
      kopplung_id: 1,
      kennung: 'k-hub',
      name: 'Hub Nord',
      richtung: 'meldet_sich',
      art: 'standard',
    },
  ],
  verlauf: [
    {
      epoche_zaehler: 1,
      art: 'angelegt',
      nach_name: 'ELW 1',
      at: '2026-11-09 12:00:00',
    },
  ],
  ...teil,
});

/** Klickt den OK-Knopf der offenen Rückfrage (er heißt oft wie der Auslöser). */
async function bestaetigeRueckfrage(name: string) {
  const knoepfe = await screen.findAllByRole('button', { name });
  await userEvent.click(knoepfe[knoepfe.length - 1]);
}

describe('FuehrungPaneel (LLH-1491)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('zeigt Stand und Verlauf; ohne Recht keine Bedienung', () => {
    renderMitProviders(<FuehrungPaneel fuehrung={akte()} darfBedienen={false} />);
    expect(screen.getByText('hier')).toBeInTheDocument();
    expect(screen.getByText('Angelegt · ELW 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /übergeben/ })).toBeNull();
  });

  it('übergibt nach der Rückfrage an das Gegenüber', async () => {
    vi.mocked(uebergebeFuehrung).mockResolvedValue(
      akte({ fuehrend: false, fuehrer_name: 'Hub Nord', epoche: 2 }),
    );
    renderMitProviders(<FuehrungPaneel fuehrung={akte()} darfBedienen />);
    await userEvent.click(screen.getByRole('button', { name: 'Führung an Hub Nord übergeben' }));
    expect(uebergebeFuehrung).not.toHaveBeenCalled();
    await bestaetigeRueckfrage('Führung übergeben');
    await waitFor(() => expect(uebergebeFuehrung).toHaveBeenCalledWith({ einsatzId: 7 }, 'k-hub'));
  });

  it('zeigt eine Ablehnung am Ort', async () => {
    vi.mocked(uebergebeFuehrung).mockRejectedValue(new Error('Führung liegt bei „Hub Nord“.'));
    renderMitProviders(<FuehrungPaneel fuehrung={akte()} darfBedienen />);
    await userEvent.click(screen.getByRole('button', { name: 'Führung an Hub Nord übergeben' }));
    await bestaetigeRueckfrage('Führung übergeben');
    expect(await screen.findByText('Nicht übergeben')).toBeInTheDocument();
  });

  it('zeigt den Abgabecode einmal in einem Dialog', async () => {
    vi.mocked(gibFuehrungPerCodeAb).mockResolvedValue({
      code: 'ABCD-EFGH-JKMN-PQRS',
      fuehrung: akte({ fuehrend: false, art: 'code_abgabe' }),
    });
    renderMitProviders(<FuehrungPaneel fuehrung={akte()} darfBedienen />);
    await userEvent.click(screen.getByRole('button', { name: 'Führung per Code abgeben' }));
    await bestaetigeRueckfrage('Code erzeugen');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Code für die Abgabe')).toBeInTheDocument();
    expect(within(dialog).getByText('ABCD-EFGH-JKMN-PQRS')).toBeInTheDocument();
    expect(gibFuehrungPerCodeAb).toHaveBeenCalledWith({ einsatzId: 7 }, 'k-hub');
  });

  it('eine offene Übernahme zeigt von wem, warum und die Entscheidung', async () => {
    vi.mocked(bestaetigeUebernahme).mockResolvedValue(akte({ fuehrend: false }));
    vi.mocked(widersprecheUebernahme).mockResolvedValue(akte());
    const offen = akte({
      offen: {
        von: 'Hub Nord',
        epoche: 2,
        grund: 'ELW ohne Verbindung',
        unterzeichner: 'Admin A',
        zeitpunkt: '2026-11-09 14:32:00',
        bruch_at: '2026-11-09 14:00:00',
        konflikt: false,
      },
    });
    renderMitProviders(<FuehrungPaneel fuehrung={offen} darfBedienen />);
    expect(screen.getByText('Führung übernommen von Hub Nord')).toBeInTheDocument();
    expect(screen.getByText('ELW ohne Verbindung')).toBeInTheDocument();
    expect(screen.getByText('Admin A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /übergeben/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Widersprechen' }));
    await bestaetigeRueckfrage('Widersprechen');
    await waitFor(() => expect(widersprecheUebernahme).toHaveBeenCalledWith({ einsatzId: 7 }));
    await userEvent.click(screen.getByRole('button', { name: 'Übernahme bestätigen' }));
    await bestaetigeRueckfrage('Übernahme bestätigen');
    await waitFor(() => expect(bestaetigeUebernahme).toHaveBeenCalledWith({ einsatzId: 7 }));
  });

  it('im Konflikt gibt es nur das Bestätigen, kein Widersprechen (LLH-1669)', async () => {
    vi.mocked(bestaetigeUebernahme).mockResolvedValue(akte({ fuehrend: false }));
    const konflikt = akte({
      art: 'notuebernahme',
      offen: {
        von: 'ELW 1',
        epoche: 2,
        bruch_at: '2026-11-09 14:00:00',
        konflikt: true,
      },
    });
    renderMitProviders(<FuehrungPaneel fuehrung={konflikt} darfBedienen />);
    expect(
      screen.getByText(
        'Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei ELW 1',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Widersprechen' })).toBeNull();
    expect(screen.queryByText('Unterzeichnet von')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Übernahme bestätigen' }));
    await bestaetigeRueckfrage('Übernahme bestätigen');
    await waitFor(() => expect(bestaetigeUebernahme).toHaveBeenCalledWith({ einsatzId: 7 }));
  });

  it('Notübernahme gegen die erreichte Seite schickt nur den Grund', async () => {
    vi.mocked(uebernimmFuehrung).mockResolvedValue(akte());
    renderMitProviders(
      <FuehrungPaneel
        fuehrung={akte({
          fuehrend: false,
          fuehrer_name: 'Hub Nord',
          fuehrer_kennung: 'k-hub',
          fuehrer_richtung: 'meldet_sich',
        })}
        darfBedienen
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Notübernahme gegen Hub Nord')).toBeInTheDocument();
    expect(within(dialog).queryByText('Code des Gegenübers')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Grund'), 'Hub weg');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung übernehmen' }));
    await waitFor(() =>
      expect(uebernimmFuehrung).toHaveBeenCalledWith({ einsatzId: 7 }, 'Hub weg'),
    );
  });

  describe('Zurückholen ohne gekoppelte Führung (LLH-1850)', () => {
    const beendet = () =>
      akte({
        fuehrend: false,
        fuehrer_name: 'Hub Nord',
        fuehrer_kennung: 'k-hub',
        gegenueber: [],
        fuehrer_beendet_at: '2026-11-10 10:00:00',
      });

    it('nennt die beendete Kopplung und holt mit Grund zurück', async () => {
      vi.mocked(holeFuehrungZurueck).mockResolvedValue(akte());
      renderMitProviders(<FuehrungPaneel fuehrung={beendet()} darfBedienen />);
      expect(screen.getByText(/^Kopplung zu Hub Nord beendet · /)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Notübernahme …' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Führung anfragen' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Führung zurückholen …' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Führung von Hub Nord zurückholen')).toBeInTheDocument();
      await userEvent.type(within(dialog).getByLabelText('Grund'), ' Hub abgebaut ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Führung zurückholen' }));
      await waitFor(() => expect(holeFuehrungZurueck).toHaveBeenCalledWith(7, 'Hub abgebaut'));
    });

    it('ohne Recht nur der Hinweis, kein Knopf', () => {
      renderMitProviders(<FuehrungPaneel fuehrung={beendet()} darfBedienen={false} />);
      expect(screen.getByText(/^Kopplung zu Hub Nord beendet · /)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Führung zurückholen …' })).toBeNull();
    });

    it('ohne Grund geht nichts hinaus', async () => {
      renderMitProviders(<FuehrungPaneel fuehrung={beendet()} darfBedienen />);
      await userEvent.click(screen.getByRole('button', { name: 'Führung zurückholen …' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Führung zurückholen' }));
      expect(await within(dialog).findByText('Grund angeben')).toBeInTheDocument();
      expect(holeFuehrungZurueck).not.toHaveBeenCalled();
    });
  });

  it('ein zu langer Grund bleibt stehen und sperrt das Absenden', async () => {
    renderMitProviders(
      <FuehrungPaneel
        fuehrung={akte({
          fuehrend: false,
          fuehrer_name: 'Hub Nord',
          fuehrer_kennung: 'k-hub',
          fuehrer_richtung: 'meldet_sich',
        })}
        darfBedienen
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Grund');
    const lang = 'x'.repeat(FUEHRUNG_GRUND_MAX + 1);
    await userEvent.click(feld);
    await userEvent.paste(lang);
    expect(feld).toHaveValue(lang);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung übernehmen' }));
    expect(
      await within(dialog).findByText(
        `Grund darf höchstens ${FUEHRUNG_GRUND_MAX} Zeichen lang sein`,
      ),
    ).toBeInTheDocument();
    expect(uebernimmFuehrung).not.toHaveBeenCalled();
  });

  it('eine abgelehnte Notübernahme zeigt den Text des Servers im Dialog und behält den Grund (LLH-1702)', async () => {
    const ablehnung =
      'Die Erklärung der Notübernahme ist zu groß für die Übertragung. Bitte den Grund kürzen.';
    vi.mocked(uebernimmFuehrung).mockRejectedValue(new ApiError(422, ablehnung));
    renderMitProviders(
      <FuehrungPaneel
        fuehrung={akte({
          fuehrend: false,
          fuehrer_name: 'Hub Nord',
          fuehrer_kennung: 'k-hub',
          fuehrer_richtung: 'meldet_sich',
        })}
        darfBedienen
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Grund');
    await userEvent.type(feld, 'Hub weg');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung übernehmen' }));
    expect(await within(dialog).findByText(ablehnung)).toBeInTheDocument();
    expect(feld).toHaveValue('Hub weg');
  });

  it('Notübernahme gegen die meldende Seite mit dem Code des Gegenübers', async () => {
    vi.mocked(uebernimmFuehrungMitCode).mockResolvedValue(akte());
    renderMitProviders(
      <FuehrungPaneel
        fuehrung={akte({
          fuehrend: false,
          fuehrer_name: 'ELW 1',
          fuehrer_richtung: 'wird_gemeldet',
        })}
        darfBedienen
        darfUnterschreiben
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Notübernahme gegen ELW 1')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Grund'), 'per Funk');
    await userEvent.click(within(dialog).getByText('Code des Gegenübers'));
    await userEvent.type(await within(dialog).findByLabelText('Code'), 'ABCD-EFGH-JKMN-PQRS');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung übernehmen' }));
    await waitFor(() =>
      expect(uebernimmFuehrungMitCode).toHaveBeenCalledWith(
        { einsatzId: 7 },
        'per Funk',
        'ABCD-EFGH-JKMN-PQRS',
      ),
    );
  });

  it('die Einsatzleitung ohne Admin-Rolle übernimmt nur mit dem Code (LLH-1676)', async () => {
    vi.mocked(uebernimmFuehrungMitCode).mockResolvedValue(akte());
    renderMitProviders(
      <FuehrungPaneel
        fuehrung={akte({
          fuehrend: false,
          fuehrer_name: 'ELW 1',
          fuehrer_richtung: 'wird_gemeldet',
        })}
        darfBedienen
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Eigene Unterschrift')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Beweis')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Grund'), 'per Funk');
    await userEvent.type(within(dialog).getByLabelText('Code'), 'ABCD-EFGH-JKMN-PQRS');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Führung übernehmen' }));
    await waitFor(() =>
      expect(uebernimmFuehrungMitCode).toHaveBeenCalledWith(
        { einsatzId: 7 },
        'per Funk',
        'ABCD-EFGH-JKMN-PQRS',
      ),
    );
    expect(uebernimmFuehrungMitUnterschrift).not.toHaveBeenCalled();
  });

  it('ein Admin wählt zwischen eigener Unterschrift und Code (LLH-1676)', async () => {
    renderMitProviders(
      <FuehrungPaneel
        fuehrung={akte({
          fuehrend: false,
          fuehrer_name: 'ELW 1',
          fuehrer_richtung: 'wird_gemeldet',
        })}
        darfBedienen
        darfUnterschreiben
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Beweis')).toBeInTheDocument();
    expect(within(dialog).getByText('Eigene Unterschrift')).toBeInTheDocument();
    expect(within(dialog).getByText('Code des Gegenübers')).toBeInTheDocument();
  });

  describe('ohne Netz (LLH-1670)', () => {
    const gegenueberFuehrt = () =>
      akte({
        fuehrend: false,
        fuehrer_name: 'Hub Nord',
        fuehrer_kennung: 'k-hub',
        fuehrer_richtung: 'meldet_sich',
      });

    it('sperrt jede Aktion der Führung und nennt den Grund', async () => {
      renderMitProviders(<FuehrungPaneel fuehrung={akte()} darfBedienen />);
      setzeOnline(false);
      const grund = await screen.findByText('Ohne Verbindung nicht änderbar');
      for (const name of ['Führung an Hub Nord übergeben', 'Führung per Code abgeben']) {
        const knopf = screen.getByRole('button', { name });
        expect(knopf).toBeDisabled();
        expect(knopf).toHaveAttribute('aria-describedby', grund.id);
      }
    });

    it('sperrt Anfrage und Notübernahme', async () => {
      renderMitProviders(<FuehrungPaneel fuehrung={gegenueberFuehrt()} darfBedienen />);
      setzeOnline(false);
      expect(await screen.findByText('Ohne Verbindung nicht änderbar')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Führung anfragen' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Notübernahme …' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Führung anfragen' }));
      expect(frageFuehrungAn).not.toHaveBeenCalled();
    });

    it.each([
      ['Führung an Hub Nord übergeben', 'Führung übergeben', uebergebeFuehrung],
      ['Führung per Code abgeben', 'Code erzeugen', gibFuehrungPerCodeAb],
    ] as const)(
      'Netz fällt bei offener Rückfrage „%s“ weg: es geht nichts hinaus, auch nicht danach',
      async (ausloeser, ok, api) => {
        renderMitProviders(<FuehrungPaneel fuehrung={akte()} darfBedienen />);
        await userEvent.click(screen.getByRole('button', { name: ausloeser }));
        const knoepfe = await screen.findAllByRole('button', { name: ok });
        setzeOnline(false);
        await userEvent.click(knoepfe[knoepfe.length - 1]);
        setzeOnline(true);
        await new Promise((r) => setTimeout(r, 50));
        expect(api).not.toHaveBeenCalled();
      },
    );

    // Je Mutation ein Fall: Die Sperre der Knöpfe deckte ein fehlendes `networkMode` sonst zu.
    const offeneUebernahme = () =>
      akte({
        offen: { von: 'Hub Nord', epoche: 2, bruch_at: '2026-11-09 14:00:00', konflikt: false },
      });
    const AKTIONEN: {
      aktion: string;
      fuehrung: () => FuehrungAnzeige;
      api: (...args: never[]) => Promise<unknown>;
      umschlag?: (f: FuehrungAnzeige) => unknown;
      ausloesen: () => Promise<unknown>;
    }[] = [
      {
        aktion: 'Übergabe',
        fuehrung: akte,
        api: uebergebeFuehrung,
        ausloesen: async () => {
          await userEvent.click(
            screen.getByRole('button', { name: 'Führung an Hub Nord übergeben' }),
          );
          await bestaetigeRueckfrage('Führung übergeben');
        },
      },
      {
        aktion: 'Abgabe per Code',
        fuehrung: akte,
        api: gibFuehrungPerCodeAb,
        umschlag: (f: FuehrungAnzeige) => ({ code: 'ABCD-EFGH-JKMN-PQRS', fuehrung: f }),
        ausloesen: async () => {
          await userEvent.click(screen.getByRole('button', { name: 'Führung per Code abgeben' }));
          await bestaetigeRueckfrage('Code erzeugen');
        },
      },
      {
        aktion: 'Anfrage',
        fuehrung: gegenueberFuehrt,
        api: frageFuehrungAn,
        ausloesen: () => userEvent.click(screen.getByRole('button', { name: 'Führung anfragen' })),
      },
      {
        aktion: 'Notübernahme',
        fuehrung: gegenueberFuehrt,
        api: uebernimmFuehrung,
        ausloesen: async () => {
          await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
          const dialog = await screen.findByRole('dialog');
          await userEvent.type(within(dialog).getByLabelText('Grund'), 'Hub weg');
          await userEvent.click(within(dialog).getByRole('button', { name: 'Führung übernehmen' }));
        },
      },
      {
        aktion: 'Bestätigen',
        fuehrung: offeneUebernahme,
        api: bestaetigeUebernahme,
        ausloesen: async () => {
          await userEvent.click(screen.getByRole('button', { name: 'Übernahme bestätigen' }));
          await bestaetigeRueckfrage('Übernahme bestätigen');
        },
      },
      {
        aktion: 'Widersprechen',
        fuehrung: offeneUebernahme,
        api: widersprecheUebernahme,
        ausloesen: async () => {
          await userEvent.click(screen.getByRole('button', { name: 'Widersprechen' }));
          await bestaetigeRueckfrage('Widersprechen');
        },
      },
    ];
    it.each(AKTIONEN)(
      '$aktion wird nie angehalten: sie geht sofort hinaus oder scheitert sofort',
      async ({ fuehrung, api, ausloesen }) => {
        // Die Antwort ist hier gleich; geprüft wird nur, ob die Anfrage sofort hinausgeht.
        vi.mocked(api).mockResolvedValue(akte() as never);
        renderMitProviders(<FuehrungPaneel fuehrung={fuehrung()} darfBedienen />);
        // Nur TanStack hält sich für offline; die App selbst sieht Netz (`useOhneVerbindung`).
        onlineManager.setOnline(false);
        await ausloesen();
        await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
      },
    );

    it.each(AKTIONEN)(
      '$aktion meldet den Stand, den der Server danach nennt',
      async ({ fuehrung, api, umschlag, ausloesen }) => {
        const antwort = akte({ epoche: 9, fuehrer_name: 'Antwort des Servers' });
        vi.mocked(api).mockResolvedValue((umschlag ? umschlag(antwort) : antwort) as never);
        const onGeaendert = vi.fn();
        renderMitProviders(
          <FuehrungPaneel fuehrung={fuehrung()} darfBedienen onGeaendert={onGeaendert} />,
        );
        await ausloesen();
        await waitFor(() => expect(onGeaendert).toHaveBeenCalledWith(antwort));
      },
    );

    it('meldet, solange eine Aktion läuft', async () => {
      let fertig: (f: FuehrungAnzeige) => void = () => {};
      vi.mocked(frageFuehrungAn).mockReturnValue(new Promise((r) => (fertig = r)));
      const onLaeuft = vi.fn();
      renderMitProviders(
        <FuehrungPaneel fuehrung={gegenueberFuehrt()} darfBedienen onLaeuft={onLaeuft} />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Führung anfragen' }));
      await waitFor(() => expect(onLaeuft).toHaveBeenLastCalledWith(true));
      fertig(gegenueberFuehrt());
      await waitFor(() => expect(onLaeuft).toHaveBeenLastCalledWith(false));
    });

    it('Netz fällt bei offenem Notübernahme-Dialog weg: der getippte Grund bleibt, nichts geht hinaus', async () => {
      renderMitProviders(<FuehrungPaneel fuehrung={gegenueberFuehrt()} darfBedienen />);
      await userEvent.click(screen.getByRole('button', { name: 'Notübernahme …' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText('Grund'), 'Hub weg');
      setzeOnline(false);
      expect(await within(dialog).findByText('Ohne Verbindung nicht änderbar')).toBeInTheDocument();
      const absenden = within(dialog).getByRole('button', { name: 'Führung übernehmen' });
      expect(absenden).toBeDisabled();
      await userEvent.click(absenden);
      setzeOnline(true);
      await new Promise((r) => setTimeout(r, 50));
      expect(uebernimmFuehrung).not.toHaveBeenCalled();
      expect(within(dialog).getByLabelText('Grund')).toHaveValue('Hub weg');
    });

    it('sperrt Bestätigen und Widersprechen einer offenen Übernahme', async () => {
      const offen = akte({
        offen: {
          von: 'Hub Nord',
          epoche: 2,
          grund: 'ELW ohne Verbindung',
          bruch_at: '2026-11-09 14:00:00',
          konflikt: false,
        },
      });
      renderMitProviders(<FuehrungPaneel fuehrung={offen} darfBedienen />);
      setzeOnline(false);
      const gruende = await screen.findAllByText('Ohne Verbindung nicht änderbar');
      expect(gruende).toHaveLength(1);
      for (const name of ['Übernahme bestätigen', 'Widersprechen']) {
        const knopf = screen.getByRole('button', { name });
        expect(knopf).toBeDisabled();
        expect(knopf).toHaveAttribute('aria-describedby', gruende[0].id);
      }
    });
  });

  describe('eine Aktion zur Zeit (LLH-1670)', () => {
    it('während die Übergabe läuft, ist die Abgabe per Code gesperrt', async () => {
      vi.mocked(uebergebeFuehrung).mockReturnValue(new Promise(() => {}));
      renderMitProviders(<FuehrungPaneel fuehrung={akte()} darfBedienen />);
      await userEvent.click(screen.getByRole('button', { name: 'Führung an Hub Nord übergeben' }));
      await bestaetigeRueckfrage('Führung übergeben');
      await waitFor(() => expect(uebergebeFuehrung).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Führung per Code abgeben' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Führung per Code abgeben' }));
      expect(gibFuehrungPerCodeAb).not.toHaveBeenCalled();
    });

    it('während die Anfrage läuft, ist die Notübernahme gesperrt', async () => {
      vi.mocked(frageFuehrungAn).mockReturnValue(new Promise(() => {}));
      renderMitProviders(
        <FuehrungPaneel
          fuehrung={akte({
            fuehrend: false,
            fuehrer_name: 'Hub Nord',
            fuehrer_kennung: 'k-hub',
            fuehrer_richtung: 'meldet_sich',
          })}
          darfBedienen
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Führung anfragen' }));
      await waitFor(() => expect(frageFuehrungAn).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Notübernahme …' })).toBeDisabled();
    });
  });
});
