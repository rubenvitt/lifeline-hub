import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MengenFeld } from './MengenFeld';

describe('MengenFeld (LFH-983)', () => {
  it('trägt den übergebenen Namen und keine englischen Stufentexte', () => {
    const { container } = render(<MengenFeld beschriftung="Menge Decken" value={3} />);
    expect(screen.getByRole('spinbutton', { name: 'Menge Decken' })).toHaveValue('3');
    expect(container.innerHTML).not.toMatch(/Increase Value|Decrease Value/);
  });

  it('beginnt bei 1 und nimmt nur ganze Zahlen', () => {
    const onChange = vi.fn();
    render(<MengenFeld beschriftung="Menge" onChange={onChange} />);
    const feld = screen.getByRole('spinbutton', { name: 'Menge' });
    expect(feld).toHaveAttribute('aria-valuemin', '1');
    expect(feld).toHaveAttribute('inputmode', 'numeric');
  });

  it('stuft per Pfeiltaste', () => {
    const onChange = vi.fn();
    render(<MengenFeld beschriftung="Menge" value={2} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Menge' }), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
