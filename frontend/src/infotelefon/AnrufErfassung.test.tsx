import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { mitProzessZone } from '../test/prozessZone';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import AnrufErfassung from './AnrufErfassung';

/** Anliegen wählen: das antd-Select öffnet per Klick, die Option ist ein `option`-Element. */
async function waehleAnliegen(label: string) {
  await userEvent.click(screen.getByLabelText('Anliegen'));
  await userEvent.click(await screen.findByTitle(label));
}

describe('AnrufErfassung (LFH-554)', () => {
  it('speichert per Enter, leert die Felder und steht wieder im Anliegen', async () => {
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />);
    await waehleAnliegen('Auskunft zur Lage');
    await userEvent.type(screen.getByLabelText('Notiz'), 'Sperrung B 3{Enter}');
    await waitFor(() =>
      expect(erfassen).toHaveBeenCalledWith({
        anliegen: 'auskunft_lage',
        notiz: 'Sperrung B 3',
        anrufer_name: undefined,
        rueckruf: undefined,
        rueckruf_noetig: false,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Notiz')).toHaveValue(''));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Anliegen')));
    expect(screen.getByText('1 erfasst')).toBeInTheDocument();
  });

  it('macht die Rückrufnummer mit „Rückruf nötig“ sichtbar und zur Pflicht', async () => {
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />);
    // Eingeklappt steht die Nummer im DOM (forceRender), aber nicht sichtbar.
    expect(screen.getByLabelText('Rückrufnummer')).not.toBeVisible();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rückruf nötig' }));
    const nummer = screen.getByLabelText('Rückrufnummer');
    expect(nummer).toBeVisible();
    await waehleAnliegen('Vermisstensuche');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Für einen Rückruf erforderlich')).toBeInTheDocument();
    expect(erfassen).not.toHaveBeenCalled();
    await userEvent.type(nummer, '0171 000{Enter}');
    await waitFor(() =>
      expect(erfassen).toHaveBeenCalledWith(
        expect.objectContaining({ rueckruf: '0171 000', rueckruf_noetig: true }),
      ),
    );
  });

  it('lässt die Felder bei Ablehnung stehen und zeigt den Grund', async () => {
    const erfassen = vi.fn().mockRejectedValue(new Error('nein'));
    const { rerender } = renderMitProviders(
      <AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />,
    );
    await waehleAnliegen('Hinweis zur Lage');
    await userEvent.type(screen.getByLabelText('Notiz'), 'Baum auf Straße{Enter}');
    await waitFor(() => expect(erfassen).toHaveBeenCalled());
    expect(screen.getByLabelText('Notiz')).toHaveValue('Baum auf Straße');
    rerender(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={new Error('nein')} />);
    expect(screen.getByText('Anruf nicht erfasst')).toBeInTheDocument();
  });
});

/** LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Einsatz auf Europe/Berlin. */
describe('AnrufErfassung — Uhrzeit in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('eine Uhrzeit 13:00 Berliner Zeit geht als 11:00 UTC hinaus', async () => {
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />
      </AnzeigeKonventionenProvider>,
    );
    await waehleAnliegen('Auskunft zur Lage');
    await userEvent.click(screen.getByText('Anrufer und Uhrzeit'));
    const uhrzeit = screen.getByRole('textbox', { name: 'Uhrzeit' });
    await userEvent.click(uhrzeit);
    await userEvent.type(uhrzeit, '30.09.2026 13:00');
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(erfassen).toHaveBeenCalledWith(
        expect.objectContaining({ eingang_at: '2026-09-30 11:00:00' }),
      ),
    );
  });
});
