import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { renderMitProviders } from '../test/utils';
import { tippeZeit, zeitFeld } from '../test/zeitEingabe';
import EtbZeitraumWahl from './EtbZeitraumWahl';

vi.mock('../offline/serveruhr', async (orig) => ({
  ...(await orig<typeof import('../offline/serveruhr')>()),
  // 17.10.2026 14:45:37 in Berlin.
  serverJetzt: () => dayjs.utc('2026-10-17 12:45:37'),
}));

afterEach(() => vi.useRealTimers());

function bau(props: Partial<Parameters<typeof EtbZeitraumWahl>[0]> = {}) {
  const onWahl = vi.fn();
  renderMitProviders(
    <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
      <EtbZeitraumWahl onWahl={onWahl} {...props} />
    </AnzeigeKonventionenProvider>,
  );
  return onWahl;
}

/*
 * Prozesszone UTC, Anzeigezone Berlin (LFH-692): sonst wäre jede Zonenaussage hier blind grün.
 */
describe('EtbZeitraumWahl (LLH-1080)', () => {
  mitProzessZone('UTC');

  it('zeigt den wirksamen Wert und schreibt eine Schnellwahl EINMAL als absolute Grenze', async () => {
    const onWahl = bau();
    const knopf = screen.getByRole('button', { name: /^Zeitraum/ });
    expect(knopf).toHaveTextContent('Zeitraum');
    await userEvent.click(knopf);
    await userEvent.click(await screen.findByRole('button', { name: 'Letzte Stunde' }));
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(onWahl).toHaveBeenCalledWith({ von: '2026-10-17 11:45:00', bis: undefined });
  });

  it('ist per Tastatur bedienbar: Fokus hinein beim Öffnen, Escape schließt und gibt ihn zurück', async () => {
    bau();
    const user = userEvent.setup();
    const knopf = screen.getByRole('button', { name: 'Zeitraum' });
    knopf.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Zeitraum' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Letzte Stunde' })).toHaveFocus(),
    );
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(knopf).toHaveAttribute('aria-expanded', 'false'));
    expect(knopf).toHaveFocus();
  });

  it('beschriftet einen gesetzten Zeitraum ohne Sekunden', () => {
    bau({ von: '2026-10-17 11:45:00' });
    expect(screen.getByRole('button', { name: /^Zeitraum/ })).toHaveTextContent('seit 1345');
  });

  it('bietet „Seit letzter Lagebesprechung“ nur mit Termin an', async () => {
    bau();
    await userEvent.click(screen.getByRole('button', { name: /^Zeitraum/ }));
    await screen.findByRole('button', { name: 'Letzte Stunde' });
    expect(screen.queryByRole('button', { name: /Seit letzter Lagebesprechung/ })).toBeNull();
  });

  it('wählt „Seit letzter Lagebesprechung“ mit ihrer Uhrzeit', async () => {
    const onWahl = bau({ letzteLb: '2026-10-17 11:30:00' });
    await userEvent.click(screen.getByRole('button', { name: /^Zeitraum/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Seit letzter Lagebesprechung (1330)' }),
    );
    expect(onWahl).toHaveBeenCalledWith({ von: '2026-10-17 11:30:00', bis: undefined });
  });

  it('nimmt einen eigenen Zeitraum taktisch getippt, „bis“ darf leer bleiben', async () => {
    const onWahl = bau();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Zeitraum/ }));
    await tippeZeit(user, await waitFor(() => zeitFeld('von')), '1400');
    await user.click(screen.getByRole('button', { name: 'Zeitraum übernehmen' }));
    expect(onWahl).toHaveBeenLastCalledWith({ von: '2026-10-17 12:00:00', bis: undefined });
  });

  it('ein eingegebenes „bis 1100“ geht als 09:00 UTC in den Filter', async () => {
    const onWahl = bau({ von: '2026-10-17 08:00:00' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Zeitraum/ }));
    await tippeZeit(user, await waitFor(() => zeitFeld('bis')), '1100');
    await user.click(screen.getByRole('button', { name: 'Zeitraum übernehmen' }));
    expect(onWahl).toHaveBeenLastCalledWith({
      von: '2026-10-17 08:00:00',
      bis: '2026-10-17 09:00:00',
    });
  });

  it('räumt einen gesetzten Zeitraum über „Ohne Zeitraum“', async () => {
    const onWahl = bau({ von: '2026-10-17 11:45:00' });
    await userEvent.click(screen.getByRole('button', { name: /^Zeitraum/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ohne Zeitraum' }));
    expect(onWahl).toHaveBeenCalledWith({ von: undefined, bis: undefined });
  });
});
