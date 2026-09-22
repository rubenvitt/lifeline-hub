import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import Sammelbanner from './Sammelbanner';

describe('Sammelbanner', () => {
  it('meldet höflich (role=status) und trägt die eine Aktion', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <Sammelbanner aktion={{ label: 'anzeigen', onKlick }}>14 neue Einträge</Sammelbanner>,
    );
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('14 neue Einträge');
    await userEvent.click(within(banner).getByRole('button', { name: 'anzeigen' }));
    expect(onKlick).toHaveBeenCalledTimes(1);
  });

  it('Blau, nicht Rot: Grund bannerGrund, Kante bannerLinie, Text bedienText', () => {
    renderMitProviders(<Sammelbanner>3 neue Meldungen</Sammelbanner>);
    const banner = screen.getByRole('status');
    expect(banner).toHaveStyle({
      background: farbenHell.bannerGrund,
      border: `1px solid ${farbenHell.bannerLinie}`,
    });
    expect(screen.getByText('3 neue Meldungen')).toHaveStyle({ color: farbenHell.bedienText });
  });

  it('die Ikone ist kein eigenes Vorleseziel', () => {
    renderMitProviders(<Sammelbanner>1 neue Meldung</Sammelbanner>);
    // antds Ikone bringt role="img" mit englischem Namen — die Hülle blendet sie aus.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
