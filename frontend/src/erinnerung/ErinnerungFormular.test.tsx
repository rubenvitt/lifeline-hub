import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import ErinnerungFormular from './ErinnerungFormular';

/**
 * Serienerfassung (LFH-343 · C8, Befund H52). Das Formular schloss nach jedem
 * Speichern und setzte auf die Defaults zurück — an einer Lage, an der im
 * Minutentakt erfasst wird, kostet genau das die meiste Zeit.
 */
describe('ErinnerungFormular — Serienerfassung', () => {
  it('bleibt nach dem Speichern offen, leert den Titel und behält die Wiederholfelder', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<ErinnerungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Werte behalten/ }));
    await userEvent.type(screen.getByLabelText('Titel'), 'Lagemeldung aller EA');
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S2');
    await userEvent.click(screen.getByRole('button', { name: /Speichern und n/ }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    // Der Anlass wechselt, der Adressat bleibt — das ist der Unterschied zwischen
    // „Formular offen lassen" und Serienerfassung.
    await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveValue(''));
    expect(screen.getByLabelText('Empfänger')).toHaveValue('S2');
  });

  it('lässt den Wortlaut stehen, wenn der Server ablehnt', async () => {
    const onAnlegen = vi.fn().mockRejectedValue(new Error('422'));
    renderMitProviders(<ErinnerungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.type(screen.getByLabelText('Titel'), 'Lagemeldung aller EA');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalled());
    // Ohne `mutateAsync` in der Kette wäre der Wortlaut trotz Fehler-Toast weg.
    expect(screen.getByLabelText('Titel')).toHaveValue('Lagemeldung aller EA');
  });
});
