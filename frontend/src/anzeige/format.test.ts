import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  formatZeit,
  formatZeitKurz,
  formatKoordinate,
  formatDistanz,
  DEFAULT_KONVENTIONEN,
} from './format';

dayjs.extend(utc);
dayjs.extend(timezone);

describe('formatZeit', () => {
  it('Default = bisheriges Verhalten: lokal DD.MM.YYYY HH:mm', () => {
    const wire = '2026-06-11 09:00:00';
    const erwartet = dayjs.utc(wire).local().format('DD.MM.YYYY HH:mm');
    expect(formatZeit(wire)).toBe(erwartet);
    expect(formatZeit(wire, DEFAULT_KONVENTIONEN)).toBe(erwartet);
  });

  it('wendet die Zeitzone an (feste Zone, TZ-robust)', () => {
    const wire = '2026-06-11 09:00:00';
    // 09:00 UTC → 11:00 in Europe/Berlin (Sommerzeit).
    expect(formatZeit(wire, { zeitzone: 'Europe/Berlin' })).toBe('11.06.2026 11:00');
    // Andere Zone → andere Uhrzeit.
    expect(formatZeit(wire, { zeitzone: 'America/New_York' })).toBe('11.06.2026 05:00');
  });

  it('12h-Format nutzt AM/PM', () => {
    const wire = '2026-06-11 15:00:00';
    expect(formatZeit(wire, { zeitzone: 'Europe/Berlin', zeitformat: '12h' })).toBe(
      '11.06.2026 05:00 PM',
    );
  });

  it('leer/null → leerer String', () => {
    expect(formatZeit(null)).toBe('');
    expect(formatZeit(undefined)).toBe('');
    expect(formatZeit('')).toBe('');
  });

  it('ungültige Zeitzone crasht nicht, fällt auf lokal zurück (Review LFH-136)', () => {
    const wire = '2026-06-11 09:00:00';
    const lokal = formatZeit(wire); // Default = lokal
    expect(() => formatZeit(wire, { zeitzone: 'Europe/Brelin' })).not.toThrow();
    expect(formatZeit(wire, { zeitzone: 'Müll/Quatsch' })).toBe(lokal);
  });
});

describe('formatZeitKurz', () => {
  it('Default = bisheriges Verhalten (HH:mm bzw. DD.MM. HH:mm)', () => {
    const heute = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
    expect(formatZeitKurz(heute)).toBe(dayjs.utc(heute).local().format('HH:mm'));
    const alt = dayjs().utc().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss');
    expect(formatZeitKurz(alt)).toBe(dayjs.utc(alt).local().format('DD.MM. HH:mm'));
  });
});

describe('formatKoordinate', () => {
  it('Default = WGS84 dezimal toFixed(5) (byte-identisch zu früher)', () => {
    expect(formatKoordinate(53.855, 8.0816667)).toBe('53.85500, 8.08167');
    expect(formatKoordinate(53.855, 8.0816667, { koordinatenformat: 'wgs84' })).toBe(
      '53.85500, 8.08167',
    );
  });

  it('MGRS-Konvention → MGRS-String', () => {
    expect(formatKoordinate(51.1, 4.1, { koordinatenformat: 'mgrs' })).toBe(
      '31U ES 77019 61520',
    );
  });

  it('UTM-Konvention → Zone/Band + gerundete Ostung/Nordung', () => {
    expect(formatKoordinate(51.1, 4.1, { koordinatenformat: 'utm' })).toBe(
      '31U 577020 5661521',
    );
  });

  it('formatiert dms über die Konvention', () => {
    expect(formatKoordinate(51.5, 10.25, { koordinatenformat: 'dms' })).toBe('51°30\'00"N 010°15\'00"E');
  });

  it('formatiert gk über die Konvention', () => {
    expect(formatKoordinate(48.782, 9.177, { koordinatenformat: 'gk' })).toMatch(/^R 35\d{5} {2}H 5\d{6}$/);
  });

  it('WGS84-Default bleibt byte-exakt', () => {
    expect(formatKoordinate(51.16040, 10.45140)).toBe('51.16040, 10.45140');
  });
});

describe('formatDistanz', () => {
  it('metrisch (Default): m bzw. km', () => {
    expect(formatDistanz(450)).toBe('450 m');
    expect(formatDistanz(1500)).toBe('1.50 km');
  });

  it('imperial: ft bzw. mi', () => {
    expect(formatDistanz(100, { einheiten: 'imperial' })).toBe('328 ft');
    expect(formatDistanz(5000, { einheiten: 'imperial' })).toBe('3.11 mi');
  });
});
