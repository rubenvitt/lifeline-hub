import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DezimalFeld } from './DezimalFeld';

describe('DezimalFeld (LLH-1146)', () => {
  it('zeigt den Wert mit Dezimalkomma und fester Stellenzahl', () => {
    render(<DezimalFeld beschriftung="Höchststand" stellen={2} value={7.1} />);
    expect(screen.getByRole('spinbutton', { name: 'Höchststand' })).toHaveValue('7,10');
  });

  it('nimmt Komma und Punkt gleichermaßen', async () => {
    for (const eingabe of ['8,5', '8.5']) {
      const onChange = vi.fn();
      const { unmount } = render(
        <DezimalFeld beschriftung="Wert" stellen={1} onChange={onChange} />,
      );
      await userEvent.type(screen.getByRole('spinbutton', { name: 'Wert' }), eingabe);
      expect(onChange).toHaveBeenLastCalledWith(8.5);
      unmount();
    }
  });

  it('nimmt auch das typografische Minus', async () => {
    const onChange = vi.fn();
    render(<DezimalFeld beschriftung="Wert" stellen={1} min={-10} onChange={onChange} />);
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Wert' }), '−3,5');
    expect(onChange).toHaveBeenLastCalledWith(-3.5);
  });

  it('formatiert beim Verlassen auf die Stellenzahl', async () => {
    render(<DezimalFeld beschriftung="Wert" stellen={1} />);
    const feld = screen.getByRole('spinbutton', { name: 'Wert' });
    await userEvent.type(feld, '8.5');
    fireEvent.blur(feld);
    expect(feld).toHaveValue('8,5');
  });

  it('hat keine Stufenknöpfe, öffnet die Dezimaltastatur und stuft per Pfeil um eine Stelle', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DezimalFeld beschriftung="Wert" stellen={2} value={7.1} onChange={onChange} />,
    );
    const feld = screen.getByRole('spinbutton', { name: 'Wert' });
    expect(container.innerHTML).not.toMatch(/Increase Value|Decrease Value/);
    expect(feld).toHaveAttribute('inputmode', 'decimal');
    fireEvent.keyDown(feld, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(7.11);
  });
});
