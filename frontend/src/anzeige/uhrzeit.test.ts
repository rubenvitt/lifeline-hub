import { describe, expect, it } from 'vitest';
import { mitProzessZone } from '../test/prozessZone';
import { alsBackendZeit } from './zeitEingabe';
import {
  naechsterTag,
  parseUhrzeit,
  tagesgrenzen,
  taktischeUhrzeitAus,
  uhrzeitAmTag,
} from './uhrzeit';

const BERLIN = 'Europe/Berlin';

describe('parseUhrzeit — Maske der Uhrzeit ohne Datum (LLH-1058)', () => {
  it('liest die Stab-Schreibweise, den Doppelpunkt und die kurzen Formen', () => {
    expect(parseUhrzeit('0630')).toBe('06:30');
    expect(parseUhrzeit('06:30')).toBe('06:30');
    expect(parseUhrzeit('630')).toBe('06:30');
    expect(parseUhrzeit('6:30')).toBe('06:30');
    expect(parseUhrzeit(' 2359 ')).toBe('23:59');
    expect(parseUhrzeit('0000')).toBe('00:00');
    expect(parseUhrzeit('1200')).toBe('12:00');
  });

  it('lehnt alles andere ab, wie der Server', () => {
    for (const s of [
      '24:00',
      '2400',
      '12:60',
      '6.30',
      '6.30 Uhr',
      '',
      '  ',
      '06:30:00',
      '12345',
      '30',
      'ab:cd',
      '０６:３０',
      '-1:30',
      '12-30',
    ]) {
      expect(parseUhrzeit(s), s).toBeNull();
    }
  });

  it('taktische Schreibweise einer gespeicherten Uhrzeit', () => {
    expect(taktischeUhrzeitAus('06:30')).toBe('0630');
    expect(taktischeUhrzeitAus('23:00')).toBe('2300');
  });

  it('nächster Kalendertag, auch über Monats- und Jahresende', () => {
    expect(naechsterTag('2026-10-11')).toBe('2026-10-12');
    expect(naechsterTag('2026-10-31')).toBe('2026-11-01');
    expect(naechsterTag('2026-12-31')).toBe('2027-01-01');
    expect(naechsterTag('2028-02-28')).toBe('2028-02-29');
  });
});

/**
 * Die Zonenrechnung läuft unter einer anderen Prozesszone als die Anzeigezone: unter der
 * Suiten-Zone Berlin wäre Anzeigezone Berlin blind (`test/prozessZone.ts`).
 */
describe('uhrzeitAmTag — Browser UTC, Anzeigezone Europe/Berlin', () => {
  mitProzessZone('UTC');

  const wire = (tag: string, uhrzeit: string) => alsBackendZeit(uhrzeitAmTag(tag, uhrzeit, BERLIN));

  it('Sommerzeit: 11.10. 06:30 Berlin ist 04:30 UTC', () => {
    expect(wire('2026-10-11', '06:30')).toBe('2026-10-11 04:30:00');
    expect(wire('2026-10-11', '00:00')).toBe('2026-10-10 22:00:00');
  });

  it('Winterzeit: 14.01. 12:00 Berlin ist 11:00 UTC', () => {
    expect(wire('2026-01-14', '12:00')).toBe('2026-01-14 11:00:00');
  });

  it('25.10.: vor und nach der Umstellung gilt der jeweilige Versatz', () => {
    expect(wire('2026-10-25', '01:30')).toBe('2026-10-24 23:30:00');
    expect(wire('2026-10-25', '06:30')).toBe('2026-10-25 05:30:00');
  });

  it('25.10. 02:30 gibt es zweimal: es gilt die erste (Sommerzeit)', () => {
    expect(wire('2026-10-25', '02:30')).toBe('2026-10-25 00:30:00');
  });

  it('29.03. 02:30 gibt es nicht: die Uhrzeit rückt nach vorn auf 03:30 Sommerzeit', () => {
    expect(wire('2026-03-29', '02:30')).toBe('2026-03-29 01:30:00');
    expect(wire('2026-03-29', '01:30')).toBe('2026-03-29 00:30:00');
    expect(wire('2026-03-29', '06:30')).toBe('2026-03-29 04:30:00');
  });

  it('Tagesgrenzen: 25.10. hat 25 Stunden, 29.03. hat 23, ein gewöhnlicher Tag 24', () => {
    const stunden = (tag: string) => {
      const { von, bis } = tagesgrenzen(tag, BERLIN);
      return (bis.valueOf() - von.valueOf()) / 3_600_000;
    };
    expect(stunden('2026-10-25')).toBe(25);
    expect(stunden('2026-03-29')).toBe(23);
    expect(stunden('2026-10-11')).toBe(24);
    const { von, bis } = tagesgrenzen('2026-10-11', BERLIN);
    expect(alsBackendZeit(von)).toBe('2026-10-10 22:00:00');
    expect(alsBackendZeit(bis)).toBe('2026-10-11 22:00:00');
  });
});

describe('uhrzeitAmTag — Browser Berlin, Anzeigezone UTC', () => {
  mitProzessZone(BERLIN);

  it('die Browserzone spielt keine Rolle', () => {
    expect(alsBackendZeit(uhrzeitAmTag('2026-10-25', '02:30', 'UTC'))).toBe('2026-10-25 02:30:00');
    expect(alsBackendZeit(uhrzeitAmTag('2026-03-29', '02:30', 'UTC'))).toBe('2026-03-29 02:30:00');
  });

  it('ohne gültige Anzeigezone gilt die Browserzone', () => {
    expect(alsBackendZeit(uhrzeitAmTag('2026-10-11', '06:30', null))).toBe('2026-10-11 04:30:00');
    expect(alsBackendZeit(uhrzeitAmTag('2026-10-11', '06:30', 'Mond/Basis'))).toBe(
      '2026-10-11 04:30:00',
    );
  });
});

describe('uhrzeitAmTag — eine Zone westlich von UTC', () => {
  mitProzessZone('UTC');

  it('New York: Umstellung am 01.11.2026, 01:30 zweimal, die erste gilt', () => {
    expect(alsBackendZeit(uhrzeitAmTag('2026-11-01', '01:30', 'America/New_York'))).toBe(
      '2026-11-01 05:30:00',
    );
    expect(alsBackendZeit(uhrzeitAmTag('2026-03-08', '02:30', 'America/New_York'))).toBe(
      '2026-03-08 07:30:00',
    );
  });
});
