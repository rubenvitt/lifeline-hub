import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { mitProzessZone } from '../test/prozessZone';
import { zeitfensterWahl, zeitraumBeschriftung, zeitfensterArten } from './zeitfenster';

const BERLIN = 'Europe/Berlin';
// 17.10.2026 14:45:37 in Berlin (Sommerzeit, UTC+2).
const JETZT = dayjs.utc('2026-10-17 12:45:37');

describe('zeitfensterWahl (LLH-1080)', () => {
  mitProzessZone('UTC');

  it('„Letzte Stunde“ und „Letzte 4 Stunden“ auf die volle Minute abgerundet, ohne „bis“', () => {
    expect(zeitfensterWahl('stunde', { jetzt: JETZT, zone: BERLIN })).toEqual({
      von: '2026-10-17 11:45:00',
    });
    expect(zeitfensterWahl('vierStunden', { jetzt: JETZT, zone: BERLIN })).toEqual({
      von: '2026-10-17 08:45:00',
    });
  });

  it('„Heute“ beginnt um Mitternacht der Anzeigezone, nicht der Prozesszone', () => {
    // Prozesszone UTC: dort begänne der Tag um 02:00 Berliner Zeit.
    expect(zeitfensterWahl('heute', { jetzt: JETZT, zone: BERLIN })).toEqual({
      von: '2026-10-16 22:00:00',
    });
  });

  it('„Seit letzter Lagebesprechung“ nur mit Termin', () => {
    expect(
      zeitfensterWahl('seitLb', { jetzt: JETZT, zone: BERLIN, letzteLb: '2026-10-17 11:30:00' }),
    ).toEqual({ von: '2026-10-17 11:30:00' });
    expect(zeitfensterWahl('seitLb', { jetzt: JETZT, zone: BERLIN })).toBeNull();
  });

  it('bietet die Lagebesprechung nur mit Termin an', () => {
    expect(zeitfensterArten({ mitLb: false })).toEqual(['stunde', 'vierStunden', 'heute']);
    expect(zeitfensterArten({ mitLb: true })).toEqual(['stunde', 'vierStunden', 'seitLb', 'heute']);
  });
});

describe('zeitraumBeschriftung (LLH-1080)', () => {
  mitProzessZone('UTC');
  const konv = { jetzt: JETZT, zone: BERLIN };

  it('leer heißt „Zeitraum“', () => {
    expect(zeitraumBeschriftung({}, konv)).toBe('Zeitraum');
  });

  it('nennt den Beginn taktisch ohne Sekunden', () => {
    expect(zeitraumBeschriftung({ von: '2026-10-17 11:45:00' }, konv)).toBe('seit 1345');
  });

  it('nennt einen anderen Tag mit Tag', () => {
    expect(zeitraumBeschriftung({ von: '2026-10-16 10:00:00' }, konv)).toBe('seit 161200');
  });

  it('erkennt „Heute“ und „seit LB“ nach dem Neuladen wieder', () => {
    expect(zeitraumBeschriftung({ von: '2026-10-16 22:00:00' }, konv)).toBe('Heute');
    expect(
      zeitraumBeschriftung(
        { von: '2026-10-17 11:30:00' },
        { ...konv, letzteLb: '2026-10-17 11:30:00' },
      ),
    ).toBe('seit LB 1330');
  });

  it('nennt einen geschlossenen Zeitraum von–bis', () => {
    expect(
      zeitraumBeschriftung({ von: '2026-10-17 08:00:00', bis: '2026-10-17 09:00:00' }, konv),
    ).toBe('1000–1100');
    expect(zeitraumBeschriftung({ bis: '2026-10-17 09:00:00' }, konv)).toBe('bis 1100');
  });
});
