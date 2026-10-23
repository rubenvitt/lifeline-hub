import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import EinheitUebernahmeStorno from './EinheitUebernahmeStorno';

/** „Übernahme stornieren“ an einer Einheit aus einer Nachforderung (LLH-1388, design.md D7). */
describe('EinheitUebernahmeStorno', () => {
  const paneel = () => screen.getByRole('region', { name: 'Übernahme stornieren' });

  async function bestaetige(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(paneel()).getByRole('button', { name: 'Übernahme stornieren' }));
    const blase = await screen.findByRole('tooltip');
    expect(blase).toHaveTextContent('Übernahme aus Nachforderung #4 stornieren?');
    expect(blase.querySelector('.ant-popconfirm-description')).toHaveTextContent(
      /^Eine dabei angelegte Einheit verlässt den Raum und wird aufgelöst, eine verknüpfte bleibt\.$/,
    );
    await user.click(within(blase).getByRole('button', { name: 'Übernahme stornieren' }));
  }

  it('bestätigt: storniert', async () => {
    const user = userEvent.setup();
    const onStornieren = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<EinheitUebernahmeStorno nachforderungId={4} onStornieren={onStornieren} />);
    await bestaetige(user);
    await waitFor(() => expect(onStornieren).toHaveBeenCalledTimes(1));
    expect(within(paneel()).queryByRole('alert')).toBeNull();
  });

  it('ohne Bestätigung: nichts geschieht', async () => {
    const user = userEvent.setup();
    const onStornieren = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<EinheitUebernahmeStorno nachforderungId={4} onStornieren={onStornieren} />);
    await user.click(within(paneel()).getByRole('button', { name: 'Übernahme stornieren' }));
    const blase = await screen.findByRole('tooltip');
    await user.click(within(blase).getByRole('button', { name: /Abbrechen|Nein|Cancel/ }));
    expect(onStornieren).not.toHaveBeenCalled();
  });

  it('abgelehnt: der Grund steht im Paneel, kein Toast', async () => {
    const user = userEvent.setup();
    const onStornieren = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'Die Übernahme ist schon storniert'));
    renderMitProviders(<EinheitUebernahmeStorno nachforderungId={4} onStornieren={onStornieren} />);
    await bestaetige(user);
    const meldung = await within(paneel()).findByRole('alert');
    expect(meldung).toHaveTextContent('Nicht storniert');
    expect(meldung).toHaveTextContent('Die Übernahme ist schon storniert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});
