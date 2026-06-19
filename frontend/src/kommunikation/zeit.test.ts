import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatZeit, formatZeitKurz, formatZeitMitKonvention } from './zeit';

dayjs.extend(utc);

describe('formatZeit', () => {
  it('parst UTC und gibt lokal DD.MM.YYYY HH:mm zurück (TZ-robust)', () => {
    const wire = '2026-06-11 09:00:00';
    const erwartet = dayjs.utc(wire).local().format('DD.MM.YYYY HH:mm');
    expect(formatZeit(wire)).toBe(erwartet);
  });

  it('gibt leeren String bei null/undefined/leer zurück', () => {
    expect(formatZeit(null)).toBe('');
    expect(formatZeit(undefined)).toBe('');
    expect(formatZeit('')).toBe('');
  });
});

describe('formatZeitKurz', () => {
  it('zeigt nur HH:mm wenn der Tag heute ist', () => {
    const heute = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
    const erwartet = dayjs.utc(heute).local().format('HH:mm');
    expect(formatZeitKurz(heute)).toBe(erwartet);
  });

  it('zeigt DD.MM. HH:mm wenn der Tag nicht heute ist', () => {
    const anderertag = dayjs().utc().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss');
    const erwartet = dayjs.utc(anderertag).local().format('DD.MM. HH:mm');
    expect(formatZeitKurz(anderertag)).toBe(erwartet);
  });

  it('gibt leeren String bei leer zurück', () => {
    expect(formatZeitKurz(null)).toBe('');
    expect(formatZeitKurz('')).toBe('');
  });
});

describe('formatZeitMitKonvention', () => {
  it('wendet Zeitzone + 12h-Format an (LFH-136)', () => {
    const wire = '2026-06-11 15:00:00';
    expect(
      formatZeitMitKonvention(wire, { zeitzone: 'Europe/Berlin', zeitformat: '12h' }),
    ).toBe('11.06.2026 05:00 PM');
  });
});
