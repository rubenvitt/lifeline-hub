import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ZeitAnzeige from './ZeitAnzeige';

// Ohne Provider greift der Default-Kontext (Lokalzeit). Wir prüfen das Format-Schema
// je Variante über einen stabilen Wire-String; die konkrete Uhrzeit hängt an der
// Runner-Zeitzone, daher Muster statt Fixwert.
describe('ZeitAnzeige', () => {
  const wire = '2026-07-16 12:30:00';

  it('rendert die reine Uhrzeit (HHmm) bei format="uhrzeit"', () => {
    render(
      <span data-testid="z">
        <ZeitAnzeige wert={wire} format="uhrzeit" />
      </span>,
    );
    expect(screen.getByTestId('z').textContent).toMatch(/^\d{4}$/);
  });

  it('rendert die volle DTG mit dt. Monatskürzel + Jahr bei format="dtgVoll"', () => {
    render(
      <span data-testid="z">
        <ZeitAnzeige wert={wire} format="dtgVoll" />
      </span>,
    );
    expect(screen.getByTestId('z').textContent).toMatch(
      /^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/,
    );
  });

  it('rendert die kurze DTG (DDHHmm) bei format="dtg"', () => {
    render(
      <span data-testid="z">
        <ZeitAnzeige wert={wire} format="dtg" />
      </span>,
    );
    expect(screen.getByTestId('z').textContent).toMatch(/^\d{6}$/);
  });

  it('rendert leer bei fehlendem Wert', () => {
    render(
      <span data-testid="z">
        <ZeitAnzeige wert={null} format="dtgVoll" />
      </span>,
    );
    expect(screen.getByTestId('z').textContent).toBe('');
  });
});
