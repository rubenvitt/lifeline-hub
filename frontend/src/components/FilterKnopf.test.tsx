import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import FilterKnopf, { filterKnopfText } from './FilterKnopf';

/** „Filter (n)“ am Handschirm (LLH-1786). */
describe('FilterKnopf', () => {
  it('nennt die Zahl nur, wenn eine Wahl gesetzt ist', () => {
    expect(filterKnopfText(0)).toBe('Filter');
    expect(filterKnopfText(2)).toBe('Filter (2)');
  });

  it('verweist nur offen auf die Wahlfläche, die dann im Baum steht', () => {
    const { rerender } = renderMitProviders(
      <FilterKnopf offen={false} onWechsel={vi.fn()} zahl={0} steuert="wahlen" />,
    );
    expect(screen.getByRole('button', { name: 'Filter' })).not.toHaveAttribute('aria-controls');
    rerender(<FilterKnopf offen onWechsel={vi.fn()} zahl={0} steuert="wahlen" />);
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute(
      'aria-controls',
      'wahlen',
    );
  });
});
