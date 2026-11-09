import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import FuehrungPaneel from './FuehrungPaneel';
import type { FuehrungAnzeige } from '../api/types';
import { FUEHRUNG_GRUND_MAX } from '../api/eingabegrenzen';

vi.mock('../api/fuehrung', () => ({
  bestaetigeUebernahme: vi.fn(),
  frageFuehrungAn: vi.fn(),
  gibFuehrungPerCodeAb: vi.fn(),
  uebergebeFuehrung: vi.fn(),
  uebernimmFuehrung: vi.fn(),
  uebernimmFuehrungMitCode: vi.fn(),
  uebernimmFuehrungMitUnterschrift: vi.fn(),
  widersprecheUebernahme: vi.fn(),
}));

import {
  bestaetigeUebernahme,
  gibFuehrungPerCodeAb,
  uebergebeFuehrung,
  uebernimmFuehrung,
  uebernimmFuehrungMitCode,
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
  gegenueber: [{ kopplung_id: 1, kennung: 'k-hub', name: 'Hub Nord', richtung: 'meldet_sich' }],
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

  it('Notübernahme gegen die meldende Seite mit dem Code des Gegenübers', async () => {
    vi.mocked(uebernimmFuehrungMitCode).mockResolvedValue(akte());
    renderMitProviders(
      <FuehrungPaneel
        fuehrung={akte({
          einsatz_id: undefined,
          fuehrend: false,
          fuehrer_name: 'ELW 1',
          fuehrer_richtung: 'wird_gemeldet',
        })}
        darfBedienen
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
        { akteId: 4 },
        'per Funk',
        'ABCD-EFGH-JKMN-PQRS',
      ),
    );
  });
});
