import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FokusBand from './FokusBand';

describe('FokusBand (LLH-1057)', () => {
  it('rendert ohne Fokus nichts', () => {
    const { container } = render(<FokusBand name={null} escHebtAuf onAufheben={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nennt den Abschnitt und hebt über „Fokus aufheben“ auf', async () => {
    const onAufheben = vi.fn();
    render(<FokusBand name="EA 1 Unterstadt" escHebtAuf onAufheben={onAufheben} />);
    const region = screen.getByRole('region', { name: 'Fokus' });
    expect(region).toHaveTextContent('EA 1 Unterstadt');
    await userEvent.click(screen.getByRole('button', { name: 'Fokus aufheben' }));
    expect(onAufheben).toHaveBeenCalledTimes(1);
  });

  it('trägt Esc am Knopf nur, wenn Esc gerade den Fokus aufhebt (sonst trifft Esc die Auswahl)', () => {
    const { rerender } = render(<FokusBand name="EA 1" escHebtAuf onAufheben={vi.fn()} />);
    const knopf = () => screen.getByRole('button', { name: 'Fokus aufheben' });
    expect(knopf()).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(document.querySelector('[data-lfh="esc-kappe"]')).not.toBeNull();
    rerender(<FokusBand name="EA 1" escHebtAuf={false} onAufheben={vi.fn()} />);
    expect(knopf()).not.toHaveAttribute('aria-keyshortcuts');
    expect(document.querySelector('[data-lfh="esc-kappe"]')).toBeNull();
  });

  it('holt sich die Zeigerereignisse zurück (Band im Fuß-Rahmen ohne Zeiger)', () => {
    render(<FokusBand name="EA 1" escHebtAuf onAufheben={vi.fn()} />);
    const band = document.querySelector<HTMLElement>('[data-lfh="fokus-band"]');
    expect(band?.style.pointerEvents).toBe('auto');
  });
});
