import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatZeit, formatZeitKurz, DEFAULT_KONVENTIONEN } from './format';

dayjs.extend(utc);

describe('formatZeit', () => {
  it('parst UTC und gibt taktische DTG lokal zurück (TZ-robust)', () => {
    const wire = '2026-06-11 09:00:00';
    const d = dayjs.utc(wire).local();
    const erwartet = `${d.format('DDHHmm')}JUN${d.format('YYYY')}`;
    expect(formatZeit(wire, DEFAULT_KONVENTIONEN)).toBe(erwartet);
  });

  it('gibt leeren String bei null/undefined/leer zurück', () => {
    expect(formatZeit(null, DEFAULT_KONVENTIONEN)).toBe('');
    expect(formatZeit(undefined, DEFAULT_KONVENTIONEN)).toBe('');
    expect(formatZeit('', DEFAULT_KONVENTIONEN)).toBe('');
  });
});

describe('formatZeitKurz', () => {
  it('zeigt nur die taktische Uhrzeit (HHmm) wenn der Tag heute ist', () => {
    const heute = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
    const erwartet = dayjs.utc(heute).local().format('HHmm');
    expect(formatZeitKurz(heute, DEFAULT_KONVENTIONEN)).toBe(erwartet);
  });

  it('zeigt die kurze DTG (DDHHmm) wenn der Tag nicht heute ist', () => {
    const anderertag = dayjs().utc().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss');
    const erwartet = dayjs.utc(anderertag).local().format('DDHHmm');
    expect(formatZeitKurz(anderertag, DEFAULT_KONVENTIONEN)).toBe(erwartet);
  });

  it('gibt leeren String bei leer zurück', () => {
    expect(formatZeitKurz(null, DEFAULT_KONVENTIONEN)).toBe('');
    expect(formatZeitKurz('', DEFAULT_KONVENTIONEN)).toBe('');
  });
});

describe('formatZeit mit Konvention', () => {
  it('wendet die Zeitzone an, ignoriert aber 12h (taktisch immer 24h)', () => {
    const wire = '2026-06-11 15:00:00'; // 15:00 UTC → 17:00 Berlin
    expect(formatZeit(wire, { zeitzone: 'Europe/Berlin', zeitformat: '12h' })).toBe(
      '111700JUN2026',
    );
  });
});
