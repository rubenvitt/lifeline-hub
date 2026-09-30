import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
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
