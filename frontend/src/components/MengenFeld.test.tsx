import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MengenFeld } from './MengenFeld';

describe('MengenFeld (LFH-983)', () => {
  it('trägt den übergebenen Namen und keine englischen Stufentexte', () => {
    const { container } = render(<MengenFeld beschriftung="Menge Decken" value={3} />);
    expect(screen.getByRole('spinbutton', { name: 'Menge Decken' })).toHaveValue('3');
    expect(container.innerHTML).not.toMatch(/Increase Value|Decrease Value/);
  });

  it('kappt nicht an einer Untergrenze und öffnet die Ziffernstatur (LLH-1768)', () => {
    const onChange = vi.fn();
    render(<MengenFeld beschriftung="Menge" onChange={onChange} />);
    const feld = screen.getByRole('spinbutton', { name: 'Menge' });
    // Die Grenze prüft `useZahlSperre`, nicht antds `min`: kein stilles Kappen beim Verlassen.
    expect(feld).not.toHaveAttribute('aria-valuemin');
    expect(feld).toHaveAttribute('inputmode', 'numeric');
  });

  it('stuft per Pfeiltaste', () => {
    const onChange = vi.fn();
    render(<MengenFeld beschriftung="Menge" value={2} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Menge' }), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
