import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KlickbareZeile } from './Klickbar';

describe('KlickbareZeile', () => {
  it('ist als fokussierbarer Button ausgezeichnet', () => {
    render(<KlickbareZeile onAktivieren={() => {}}>Auswahl</KlickbareZeile>);

    expect(screen.getByRole('button', { name: 'Auswahl' })).toHaveAttribute('tabindex', '0');
  });

  it('aktiviert mit Enter genau einmal', async () => {
    const user = userEvent.setup();
    const onAktivieren = vi.fn();
    render(<KlickbareZeile onAktivieren={onAktivieren}>Auswahl</KlickbareZeile>);

    screen.getByRole('button', { name: 'Auswahl' }).focus();
    await user.keyboard('{Enter}');

    expect(onAktivieren).toHaveBeenCalledTimes(1);
  });

  it('aktiviert mit Space genau einmal', async () => {
    const user = userEvent.setup();
    const onAktivieren = vi.fn();
    render(<KlickbareZeile onAktivieren={onAktivieren}>Auswahl</KlickbareZeile>);

    screen.getByRole('button', { name: 'Auswahl' }).focus();
    await user.keyboard(' ');

    expect(onAktivieren).toHaveBeenCalledTimes(1);
  });

  it('ignoriert andere Tasten', async () => {
    const user = userEvent.setup();
    const onAktivieren = vi.fn();
    render(<KlickbareZeile onAktivieren={onAktivieren}>Auswahl</KlickbareZeile>);

    screen.getByRole('button', { name: 'Auswahl' }).focus();
    await user.keyboard('a');

    expect(onAktivieren).not.toHaveBeenCalled();
  });

  it('aktiviert die Zeile nicht über interaktive Kindelemente', async () => {
    const user = userEvent.setup();
    const onAktivieren = vi.fn();
    const onKindAktion = vi.fn();
    render(
      <KlickbareZeile onAktivieren={onAktivieren}>
        Auswahl <button onClick={onKindAktion}>Eigene Aktion</button>
      </KlickbareZeile>,
    );

    const kind = screen.getByRole('button', { name: 'Eigene Aktion' });
    await user.click(kind);
    kind.focus();
    await user.keyboard('{Enter}');

    expect(onKindAktion).toHaveBeenCalledTimes(2);
    expect(onAktivieren).not.toHaveBeenCalled();
  });
});
