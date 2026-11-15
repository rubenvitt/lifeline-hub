import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import EinheitAufloesen from './EinheitAufloesen';

/**
 * „Einheit auflösen oder stornieren“ als letztes Paneel (LLH-1036, design.md D12; Stornieren
 * LLH-1881).
 */
describe('EinheitAufloesen', () => {
  const paneel = () => screen.getByRole('region', { name: 'Einheit auflösen oder stornieren' });

  function rendere(
    onAufloesen = vi.fn().mockResolvedValue(undefined),
    onStornieren = vi.fn().mockResolvedValue(undefined),
  ) {
    renderMitProviders(<EinheitAufloesen onAufloesen={onAufloesen} onStornieren={onStornieren} />);
    return { onAufloesen, onStornieren };
  }

  /** Öffnet die Rückfrage des Knopfs, prüft ihren Satz zur Folge und bestätigt mit `knopf`. */
  async function bestaetige(
    user: ReturnType<typeof userEvent.setup>,
    knopf: string,
    folge: RegExp,
  ) {
    await user.click(within(paneel()).getByRole('button', { name: knopf }));
    const blase = await screen.findByRole('tooltip');
    // Ein kurzer Satz zur Folge (LLH-1079), kein Bedienhinweis (LFH-1078).
    expect(blase.querySelector('.ant-popconfirm-description')).toHaveTextContent(folge);
    await user.click(within(blase).getByRole('button', { name: knopf }));
  }

  const FOLGE_AUFLOESEN =
    /^Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch, gekoppelte Geräte enden\.$/;
  // Stornieren läuft serverseitig wie das Auflösen ohne Spur (`aufloesen_tx`): Unter-Einheiten und
  // gekoppelte Geräte sind keine Spur und enden mit (LLH-1881).
  const FOLGE_STORNIEREN =
    /^Unter-Einheiten rücken eine Ebene hoch, gekoppelte Geräte enden, die Einheit wird gelöscht\.$/;

  it('Auflösen bestätigt: löst auf, storniert nicht', async () => {
    const user = userEvent.setup();
    const { onAufloesen, onStornieren } = rendere();
    await bestaetige(user, 'Einheit auflösen', FOLGE_AUFLOESEN);
    await waitFor(() => expect(onAufloesen).toHaveBeenCalledTimes(1));
    expect(onStornieren).not.toHaveBeenCalled();
    expect(within(paneel()).queryByRole('alert')).toBeNull();
  });

  it('Stornieren bestätigt: storniert, löst nicht auf', async () => {
    const user = userEvent.setup();
    const { onAufloesen, onStornieren } = rendere();
    await bestaetige(user, 'Einheit stornieren', FOLGE_STORNIEREN);
    await waitFor(() => expect(onStornieren).toHaveBeenCalledTimes(1));
    expect(onAufloesen).not.toHaveBeenCalled();
    expect(within(paneel()).queryByRole('alert')).toBeNull();
  });

  it.each(['Einheit auflösen', 'Einheit stornieren'])(
    '%s ohne Bestätigung: nichts geschieht',
    async (knopf) => {
      const user = userEvent.setup();
      const { onAufloesen, onStornieren } = rendere();
      await user.click(within(paneel()).getByRole('button', { name: knopf }));
      const blase = await screen.findByRole('tooltip');
      await user.click(within(blase).getByRole('button', { name: /Abbrechen|Nein|Cancel/ }));
      expect(onAufloesen).not.toHaveBeenCalled();
      expect(onStornieren).not.toHaveBeenCalled();
    },
  );

  it('Auflösen abgelehnt: der Grund steht im Paneel, kein Toast', async () => {
    const user = userEvent.setup();
    rendere(vi.fn().mockRejectedValue(new ApiError(409, 'Einheit ist disponiert')));
    await bestaetige(user, 'Einheit auflösen', FOLGE_AUFLOESEN);
    const meldung = await within(paneel()).findByRole('alert');
    expect(meldung).toHaveTextContent('Nicht aufgelöst');
    expect(meldung).toHaveTextContent('Einheit ist disponiert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Stornieren abgelehnt: der Grund des Servers steht im Paneel, kein Toast', async () => {
    const user = userEvent.setup();
    const grund = 'Der Einheit gehört Personal an; die Einheit lässt sich nur auflösen';
    rendere(undefined, vi.fn().mockRejectedValue(new ApiError(422, grund)));
    await bestaetige(user, 'Einheit stornieren', FOLGE_STORNIEREN);
    const meldung = await within(paneel()).findByRole('alert');
    expect(meldung).toHaveTextContent('Nicht storniert');
    expect(meldung).toHaveTextContent(grund);
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it.each([
    ['Einheit stornieren', 'Einheit auflösen', FOLGE_STORNIEREN],
    ['Einheit auflösen', 'Einheit stornieren', FOLGE_AUFLOESEN],
  ])('solange „%s“ läuft, ist „%s“ gesperrt', async (laufend, anderer, folge) => {
    const user = userEvent.setup();
    let fertig!: () => void;
    const offen = () =>
      new Promise<void>((resolve) => {
        fertig = resolve;
      });
    if (laufend === 'Einheit stornieren') rendere(undefined, vi.fn(offen));
    else rendere(vi.fn(offen));
    expect(within(paneel()).getByRole('button', { name: anderer })).toBeEnabled();
    await bestaetige(user, laufend, folge);
    await waitFor(() =>
      expect(within(paneel()).getByRole('button', { name: anderer })).toBeDisabled(),
    );
    fertig();
    await waitFor(() =>
      expect(within(paneel()).getByRole('button', { name: anderer })).toBeEnabled(),
    );
  });

  it('ein neuer Versuch räumt die alte Ablehnung weg', async () => {
    const user = userEvent.setup();
    rendere(
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(new ApiError(422, 'Die Einheit hat eine Zeitachse')),
    );
    await bestaetige(user, 'Einheit stornieren', FOLGE_STORNIEREN);
    expect(await within(paneel()).findByRole('alert')).toHaveTextContent('Nicht storniert');
    await bestaetige(user, 'Einheit auflösen', FOLGE_AUFLOESEN);
    await waitFor(() => expect(within(paneel()).queryByRole('alert')).toBeNull());
  });
});
