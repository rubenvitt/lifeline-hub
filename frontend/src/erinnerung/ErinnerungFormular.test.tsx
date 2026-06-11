import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import ErinnerungFormular, { dayjsZuWire } from './ErinnerungFormular';

dayjs.extend(utc);

describe('dayjsZuWire', () => {
  it('formatiert auf UTC-Wireformat mit Sekunden', () => {
    // jsdom läuft auf TZ=UTC → lokal == UTC; geprüft wird das Format.
    expect(dayjsZuWire(dayjs.utc('2026-06-11 14:30:00'))).toBe('2026-06-11 14:30:00');
  });
});

describe('ErinnerungFormular', () => {
  it('verhindert Anlegen ohne Titel und ohne gewählte Fälligkeit', () => {
    const onAnlegen = vi.fn();
    render(<ErinnerungFormular senden={false} onAnlegen={onAnlegen} />);
    fireEvent.click(screen.getByRole('button', { name: /anlegen/i }));
    expect(onAnlegen).not.toHaveBeenCalled();
  });

  it('verhindert Anlegen mit Titel aber ohne Fälligkeit', () => {
    const onAnlegen = vi.fn();
    render(<ErinnerungFormular senden={false} onAnlegen={onAnlegen} />);
    fireEvent.change(screen.getByLabelText(/titel/i), { target: { value: 'Ablöse prüfen' } });
    fireEvent.click(screen.getByRole('button', { name: /anlegen/i }));
    expect(onAnlegen).not.toHaveBeenCalled();
  });
});
