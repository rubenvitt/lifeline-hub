import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import ErinnerungFormular, { dayjsZuWire } from './ErinnerungFormular';

dayjs.extend(utc);

describe('dayjsZuWire', () => {
  it('normalisiert eine lokale Picker-Zeit zurück auf UTC-Wireformat mit Sekunden', () => {
    // Fester Instant 14:30 UTC, aber als Dayjs im Lokal-Modus übergeben — so liefert
    // ihn der antd-DatePicker. Der Helfer MUSS per .utc() auf den UTC-Instant
    // zurücknormalisieren → '2026-06-11 14:30:00', deterministisch unabhängig von der
    // Test-TZ. Entfernt man .utc() aus dem Helfer, rendert .format() in Lokalzeit und
    // der Test fällt auf jeder Nicht-UTC-Maschine — so wird der local→UTC-Shift echt
    // exerziert (statt durch UTC-Input zum No-op zu werden).
    const lokal = dayjs.utc('2026-06-11 14:30:00').local();
    expect(dayjsZuWire(lokal)).toBe('2026-06-11 14:30:00');
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
