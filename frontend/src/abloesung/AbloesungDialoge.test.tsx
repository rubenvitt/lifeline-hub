import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import type { Abloesung } from '../api/types';
import { mitProzessZone } from '../test/prozessZone';
import { renderMitProviders } from '../test/utils';
import { SchichtBeginnenDialog, VollzugDialog } from './AbloesungDialoge';

/**
 * LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. Beide Zeitfelder
 * der Ablösung lesen die eingegebene Uhrzeit in der Anzeigezone.
 */
describe('Ablösung — Zeiten in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  const BERLIN = { zeitzone: 'Europe/Berlin' };

  async function tippeZeit(feld: HTMLElement, text: string) {
    await userEvent.click(feld);
    await userEvent.type(feld, text);
    await userEvent.keyboard('{Enter}');
  }

  it('Vollzug: 13:00 Berliner Zeit geht als 11:00 UTC hinaus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <VollzugDialog
          schicht={{ id: 3, einheit_name: 'Florian 1' } as Abloesung}
          einheiten={[]}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await tippeZeit(within(dialog).getByRole('textbox', { name: 'Zeitpunkt' }), '2026-09-24 13:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        expect.objectContaining({ vollzogen_at: '2026-09-24 11:00:00' }),
      ),
    );
  });

  it('Schicht beginnen: „im Einsatz seit“ 06:30 Berliner Zeit geht als 04:30 UTC hinaus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <SchichtBeginnenDialog
          offen
          einheiten={[{ value: 5, label: 'Florian 1' }]}
          vorgabeJeEinheit={new Map([[5, 360]])}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    const option = await waitFor(() => {
      const k = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Florian 1"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    await userEvent.click(option);
    await tippeZeit(
      within(dialog).getByRole('textbox', { name: 'Im Einsatz seit' }),
      '2026-09-24 06:30',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schicht beginnen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        expect.objectContaining({ einheit_id: 5, beginn_at: '2026-09-24 04:30:00' }),
      ),
    );
  });
});
