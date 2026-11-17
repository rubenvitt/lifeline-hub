import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { KennungMitZusatz } from './KennungMitZusatz';

describe('KennungMitZusatz (LLH-1790)', () => {
  it('setzt den Zusatz gedämpft unter die Kennung', () => {
    renderMitProviders(<KennungMitZusatz kennung={<span>KTW 85-2</span>} zusatz="KTW" />);
    const zusatz = screen.getByText('KTW', { selector: '[data-lfh="kennung-zusatz"]' });
    expect(zusatz).toHaveClass('ant-typography-secondary');
  });

  it('ohne Zusatz keine leere zweite Zeile', () => {
    const { container } = renderMitProviders(
      <KennungMitZusatz kennung={<span>KTW 85-2</span>} zusatz="  " />,
    );
    expect(container.querySelector('[data-lfh="kennung-zusatz"]')).toBeNull();
  });
});
