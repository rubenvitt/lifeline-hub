import { render, screen } from '@testing-library/react';
import { Button } from 'antd';
import { describe, expect, it } from 'vitest';
import BreiteHalten from './BreiteHalten';

describe('BreiteHalten (LLH-1627)', () => {
  it('der Knopf heißt nur nach dem sichtbaren Wortlaut, die Reserve ist stumm', () => {
    render(
      <Button>
        <BreiteHalten reserve={['Auflösen (noch 00 Personen)']}>Auflösen</BreiteHalten>
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Auflösen' })).toBeInTheDocument();
    const reserve = screen.getByText('Auflösen (noch 00 Personen)');
    expect(reserve).toHaveAttribute('aria-hidden', 'true');
    expect(reserve).toHaveStyle({ visibility: 'hidden' });
  });

  it('sichtbare Form und Reserve liegen in derselben Rasterzelle, Ziffern tabellarisch', () => {
    render(<BreiteHalten reserve={['noch 00 Personen']}>noch 1 Person</BreiteHalten>);
    const huelle = document.querySelector('[data-lfh="breite-halten"]') as HTMLElement;
    expect(huelle).toHaveStyle({ display: 'inline-grid', fontVariantNumeric: 'tabular-nums' });
    for (const kind of Array.from(huelle.children)) {
      expect(kind).toHaveStyle({ gridArea: '1 / 1' });
    }
  });
});
