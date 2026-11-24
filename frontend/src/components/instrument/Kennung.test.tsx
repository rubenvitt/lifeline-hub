import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { schrift } from '../../theme/tokens';
import Kennung from './Kennung';

describe('Kennung', () => {
  it('setzt einen Funkrufnamen in Mono und markiert ihn als Kennung', () => {
    renderMitProviders(<Kennung>Florian Musterstadt 46/11-1</Kennung>);
    const el = screen.getByText('Florian Musterstadt 46/11-1');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveAttribute('data-schrift', 'kennung');
    expect(el).toHaveStyle({ fontFamily: schrift.zahl, fontSize: '13px' });
  });

  it('nimmt Stufe und Gewicht wie monoStil', () => {
    renderMitProviders(
      <Kennung stufe="monoGross" gewicht={500}>
        RK Musterstadt 1/83-1
      </Kennung>,
    );
    expect(screen.getByText('RK Musterstadt 1/83-1')).toHaveStyle({
      fontSize: '14px',
      fontWeight: '500',
    });
  });

  it('reicht zusätzliche Stile durch, ohne die Familie zu verlieren', () => {
    renderMitProviders(<Kennung style={{ color: 'red' }}>ELW 1</Kennung>);
    expect(screen.getByText('ELW 1')).toHaveStyle({
      color: 'rgb(255, 0, 0)',
      fontFamily: schrift.zahl,
    });
  });
});
