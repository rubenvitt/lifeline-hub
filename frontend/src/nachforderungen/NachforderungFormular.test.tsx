import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import NachforderungFormular from './NachforderungFormular';

/**
 * Serienerfassung (LFH-343 · C8, Befund H52). Wer nachfordert, fordert meist
 * mehreres bei derselben Stelle nach — Adressat und Dringlichkeit bleiben, Art
 * und Bezeichnung wechseln.
 */
describe('NachforderungFormular — Serienerfassung', () => {
  it('bleibt nach dem Speichern offen, leert die Art und behält den Adressaten', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Werte behalten/ }));
    await userEvent.type(screen.getByLabelText('Art'), 'RTW');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Zwei RTW zur Verstärkung');
    await userEvent.type(screen.getByPlaceholderText('z. B. Leitstelle Nord'), 'Leitstelle Nord');
    await userEvent.click(screen.getByRole('button', { name: /Speichern und n/ }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Art')).toHaveValue(''));
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
    expect(screen.getByPlaceholderText('z. B. Leitstelle Nord')).toHaveValue('Leitstelle Nord');
  });

  it('lässt die Eingabe stehen, wenn der Server ablehnt', async () => {
    const onAnlegen = vi.fn().mockRejectedValue(new Error('422'));
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.type(screen.getByLabelText('Art'), 'RTW');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Zwei RTW');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalled());
    expect(screen.getByLabelText('Art')).toHaveValue('RTW');
  });
});
