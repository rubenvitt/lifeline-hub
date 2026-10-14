import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import EinheitAufloesen from './EinheitAufloesen';

/** „Einheit auflösen“ als letztes Paneel (LLH-1036, design.md D12). */
describe('EinheitAufloesen', () => {
  const paneel = () => screen.getByRole('region', { name: 'Einheit auflösen' });

  async function bestaetige(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(paneel()).getByRole('button', { name: 'Einheit auflösen' }));
    const blase = await screen.findByRole('tooltip');
    // Ein kurzer Satz zur Folge aus LLH-1079, kein Bedienhinweis (LFH-1078).
    expect(blase.querySelector('.ant-popconfirm-description')).toHaveTextContent(
      /^Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch\.$/,
    );
    await user.click(within(blase).getByRole('button', { name: 'Einheit auflösen' }));
  }

  it('bestätigt: löst auf', async () => {
    const user = userEvent.setup();
    const onAufloesen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<EinheitAufloesen onAufloesen={onAufloesen} />);
    await bestaetige(user);
    await waitFor(() => expect(onAufloesen).toHaveBeenCalledTimes(1));
    expect(within(paneel()).queryByRole('alert')).toBeNull();
  });

  it('ohne Bestätigung: nichts geschieht', async () => {
    const user = userEvent.setup();
    const onAufloesen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<EinheitAufloesen onAufloesen={onAufloesen} />);
    await user.click(within(paneel()).getByRole('button', { name: 'Einheit auflösen' }));
    const blase = await screen.findByRole('tooltip');
    await user.click(within(blase).getByRole('button', { name: /Abbrechen|Nein|Cancel/ }));
    expect(onAufloesen).not.toHaveBeenCalled();
  });

  it('abgelehnt: der Grund steht im Paneel, kein Toast', async () => {
    const user = userEvent.setup();
    const onAufloesen = vi.fn().mockRejectedValue(new ApiError(409, 'Einheit ist disponiert'));
    renderMitProviders(<EinheitAufloesen onAufloesen={onAufloesen} />);
    await bestaetige(user);
    const meldung = await within(paneel()).findByRole('alert');
    expect(meldung).toHaveTextContent('Nicht aufgelöst');
    expect(meldung).toHaveTextContent('Einheit ist disponiert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});
