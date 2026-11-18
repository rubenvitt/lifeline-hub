import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import { Marke } from './Marke';

describe('Marke', () => {
  it('neutral und randlos: zweite Textstufe auf flaeche2, kein Formzeichen', () => {
    renderMitProviders(<Marke>ad-hoc</Marke>);
    const m = document.querySelector<HTMLElement>('[data-lfh="marke"]')!;
    expect(m).toHaveTextContent('ad-hoc');
    expect(m).toHaveStyle({
      background: farbenHell.flaeche2,
      color: farbenHell.gedaempft,
      height: '20px',
    });
    expect(m.style.border).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('entfernbar heißt bedienbar: Rahmen und ein Knopf ✕ mit Namen', async () => {
    const weg = vi.fn();
    renderMitProviders(<Marke onEntfernen={weg}>Suche: „85“</Marke>);
    const m = document.querySelector<HTMLElement>('[data-lfh="marke"]')!;
    expect(m.style.border).toContain('1px solid');
    await userEvent.click(screen.getByRole('button', { name: 'Suche: „85“ entfernen' }));
    expect(weg).toHaveBeenCalledOnce();
  });
});
