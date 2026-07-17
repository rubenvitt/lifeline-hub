import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatZeit, formatZeitKurz, formatZeitMitKonvention } from './zeit';

dayjs.extend(utc);

describe('formatZeit', () => {
  it('parst UTC und gibt taktische DTG lokal zurück (TZ-robust)', () => {
    const wire = '2026-06-11 09:00:00';
    const d = dayjs.utc(wire).local();
    const erwartet = `${d.format('DDHHmm')}JUN${d.format('YYYY')}`;
    expect(formatZeit(wire)).toBe(erwartet);
  });

  it('gibt leeren String bei null/undefined/leer zurück', () => {
    expect(formatZeit(null)).toBe('');
    expect(formatZeit(undefined)).toBe('');
    expect(formatZeit('')).toBe('');
  });
});

describe('formatZeitKurz', () => {
  it('zeigt nur die taktische Uhrzeit (HHmm) wenn der Tag heute ist', () => {
    const heute = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
    const erwartet = dayjs.utc(heute).local().format('HHmm');
    expect(formatZeitKurz(heute)).toBe(erwartet);
  });

  it('zeigt die kurze DTG (DDHHmm) wenn der Tag nicht heute ist', () => {
    const anderertag = dayjs().utc().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss');
    const erwartet = dayjs.utc(anderertag).local().format('DDHHmm');
    expect(formatZeitKurz(anderertag)).toBe(erwartet);
  });

  it('gibt leeren String bei leer zurück', () => {
    expect(formatZeitKurz(null)).toBe('');
    expect(formatZeitKurz('')).toBe('');
  });
});

describe('formatZeitMitKonvention', () => {
  it('wendet die Zeitzone an, ignoriert aber 12h (taktisch immer 24h)', () => {
    const wire = '2026-06-11 15:00:00'; // 15:00 UTC → 17:00 Berlin
    expect(
      formatZeitMitKonvention(wire, { zeitzone: 'Europe/Berlin', zeitformat: '12h' }),
    ).toBe('111700JUN2026');
  });
});
