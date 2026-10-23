import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ZeitAnzeige from './ZeitAnzeige';
import { AnzeigeKonventionenProvider } from './AnzeigeKonventionenContext';
import type { AnzeigeKonventionen } from './format';

const wire = '2026-07-16 12:30:00'; // 16.07.2026 14:30 Berlin
const alt = '2020-07-16 12:30:00'; // sicher nicht heute

function zeige(knoten: React.ReactNode, konventionen?: AnzeigeKonventionen): string {
  render(
    <span data-testid="z">
      {konventionen ? (
        <AnzeigeKonventionenProvider konventionen={konventionen}>
          {knoten}
        </AnzeigeKonventionenProvider>
      ) : (
        knoten
      )}
    </span>,
  );
  return screen.getByTestId('z').textContent ?? '';
}

const BERLIN = { zeitzone: 'Europe/Berlin' };

describe('ZeitAnzeige — Rollen (LLH-1053)', () => {
  it('Vorgabe ist die Rolle Zeitpunkt, taktisch: volle DTG', () => {
    expect(zeige(<ZeitAnzeige wert={wire} />, BERLIN)).toBe('161430jul26');
  });
  it('rolle="uhrzeit" zeigt nur die Uhrzeit', () => {
    expect(zeige(<ZeitAnzeige wert={wire} rolle="uhrzeit" />, BERLIN)).toBe('1430');
  });
  it('rolle="kurz" zeigt an einem anderen Tag Tag und Uhrzeit', () => {
    expect(zeige(<ZeitAnzeige wert={alt} rolle="kurz" />, BERLIN)).toBe('161430');
  });
  it('folgt der Darstellung „Datum und Uhrzeit“ aus den Konventionen', () => {
    expect(
      zeige(<ZeitAnzeige wert={wire} />, { ...BERLIN, zeitdarstellung: 'datum_uhrzeit' }),
    ).toBe('16.07.26 14:30');
  });
  it('ohne Provider gilt die Vorgabe taktisch (Browserzone, daher Muster)', () => {
    expect(zeige(<ZeitAnzeige wert={wire} />)).toMatch(/^\d{6}jul26$/);
  });
  it('rendert leer bei fehlendem Wert', () => {
    expect(zeige(<ZeitAnzeige wert={null} />, BERLIN)).toBe('');
  });
});

describe('ZeitAnzeige — alte Formatnamen leiten weiter', () => {
  it('dtgVoll → Zeitpunkt, uhrzeit → Uhrzeit, kurz → kurz', () => {
    expect(zeige(<ZeitAnzeige wert={wire} format="dtgVoll" />, BERLIN)).toBe('161430jul26');
  });
  it('dtg bleibt die reine Tagesform', () => {
    expect(zeige(<ZeitAnzeige wert={wire} format="dtg" />, BERLIN)).toBe('161430');
  });
});
