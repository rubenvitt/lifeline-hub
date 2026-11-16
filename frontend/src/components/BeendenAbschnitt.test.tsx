import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../api/client';
import { renderMitProviders } from '../test/utils';
import BeendenAbschnitt, { type BeendenSchritt } from './BeendenAbschnitt';

/**
 * Der letzte Abschnitt für endgültiges Beenden (LLH-1722, Spec `bedien-muster`): je Schritt ein
 * roter Knopf mit Rückfrage, die die Handlung nennt; gesperrt mit Grund daneben; die Ablehnung
 * im Abschnitt, kein Toast.
 */
const schritt = (teil: Partial<BeendenSchritt> = {}): BeendenSchritt => ({
  key: 'aufloesen',
  knopf: 'UHS auflösen',
  frage: 'UHS auflösen?',
  folge: 'Die UHS nimmt keine Patienten mehr auf.',
  fehlerTitel: 'Nicht aufgelöst',
  fehlerFallback: 'Auflösen fehlgeschlagen',
  ausfuehren: vi.fn().mockResolvedValue(undefined),
  ...teil,
});

describe('BeendenAbschnitt (LLH-1722)', () => {
  it('erst die Rückfrage mit der Handlung führt aus', async () => {
    const s = schritt();
    renderMitProviders(<BeendenAbschnitt titel="UHS auflösen oder stornieren" schritte={[s]} />);
    const abschnitt = screen.getByRole('region', { name: 'UHS auflösen oder stornieren' });
    await userEvent.click(within(abschnitt).getByRole('button', { name: 'UHS auflösen' }));
    expect(s.ausfuehren).not.toHaveBeenCalled();
    expect(await screen.findByText('Die UHS nimmt keine Patienten mehr auf.')).toBeInTheDocument();
    const bestaetigen = screen
      .getAllByRole('button', { name: 'UHS auflösen' })
      .find((b) => b.closest('.ant-popconfirm'))!;
    await userEvent.click(bestaetigen);
    expect(s.ausfuehren).toHaveBeenCalledTimes(1);
  });

  it('gesperrt steht der Knopf mit dem Grund daneben', () => {
    renderMitProviders(
      <BeendenAbschnitt titel="UHS auflösen" schritte={[schritt({ sperre: 'noch 3 Personen' })]} />,
    );
    const knopf = screen.getByRole('button', { name: 'UHS auflösen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('noch 3 Personen');
  });

  it('eine Ablehnung steht im Abschnitt, kein Toast', async () => {
    const s = schritt({
      ausfuehren: vi.fn().mockRejectedValue(new ApiError(409, 'Noch Patienten an der UHS')),
    });
    renderMitProviders(<BeendenAbschnitt titel="UHS auflösen" schritte={[s]} />);
    await userEvent.click(screen.getByRole('button', { name: 'UHS auflösen' }));
    const bestaetigen = (await screen.findAllByRole('button', { name: 'UHS auflösen' })).find((b) =>
      b.closest('.ant-popconfirm'),
    )!;
    await userEvent.click(bestaetigen);
    const abschnitt = screen.getByRole('region', { name: 'UHS auflösen' });
    await waitFor(() =>
      expect(within(abschnitt).getByText('Noch Patienten an der UHS')).toBeInTheDocument(),
    );
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});
