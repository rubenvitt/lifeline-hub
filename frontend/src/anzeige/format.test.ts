import { describe, it, expect, vi, afterEach } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  formatZeit,
  formatZeitKurz,
  formatUhrzeit,
  formatUhrzeitMitTag,
  taktischeUhrzeit,
  taktischeDtg,
  taktischeDtgVoll,
  formatKoordinate,
  formatDistanz,
  DEFAULT_KONVENTIONEN,
} from './format';

dayjs.extend(utc);
dayjs.extend(timezone);

// LFH-141: taktische Schreibweise (1430 / 161430 / 161430JUL2026, dt. Monatskürzel).
describe('taktische Zeit-Varianten', () => {
  const wire = '2026-07-16 12:30:00'; // fest, Zeitzone-Tests unten

  it('taktischeUhrzeit = HHmm (1230 UTC → 1430 Berlin)', () => {
    expect(taktischeUhrzeit(wire, { zeitzone: 'Europe/Berlin' })).toBe('1430');
  });
  it('taktischeDtg = DDHHmm (161430)', () => {
    expect(taktischeDtg(wire, { zeitzone: 'Europe/Berlin' })).toBe('161430');
  });
  it('taktischeDtgVoll = DDHHmm + dt. Monatskürzel + Jahr (161430JUL2026)', () => {
    expect(taktischeDtgVoll(wire, { zeitzone: 'Europe/Berlin' })).toBe('161430JUL2026');
    // Umlaut-Monat: März → MÄR
    expect(taktischeDtgVoll('2026-03-01 06:00:00', { zeitzone: 'Europe/Berlin' })).toBe('010700MÄR2026');
  });
  it('leer/null → leerer String', () => {
    expect(taktischeUhrzeit(null)).toBe('');
    expect(taktischeDtgVoll(undefined)).toBe('');
  });
});

describe('formatZeit (taktische DTG)', () => {
  it('Default = taktische DTG in Lokalzeit', () => {
    const wire = '2026-06-11 09:00:00';
    const d = dayjs.utc(wire).local();
    const erwartet = `${d.format('DDHHmm')}JUN${d.format('YYYY')}`;
    expect(formatZeit(wire)).toBe(erwartet);
    expect(formatZeit(wire, DEFAULT_KONVENTIONEN)).toBe(erwartet);
  });

  it('wendet die Zeitzone an (TZ-robust)', () => {
    const wire = '2026-06-11 09:00:00';
    // 09:00 UTC → 11:00 Berlin (Sommerzeit) bzw. 05:00 New York.
    expect(formatZeit(wire, { zeitzone: 'Europe/Berlin' })).toBe('111100JUN2026');
    expect(formatZeit(wire, { zeitzone: 'America/New_York' })).toBe('110500JUN2026');
  });

  it('ignoriert das 12h-Setting — taktisch ist immer 24h', () => {
    const wire = '2026-06-11 15:00:00'; // 15:00 UTC → 17:00 Berlin
    expect(formatZeit(wire, { zeitzone: 'Europe/Berlin', zeitformat: '12h' })).toBe('111700JUN2026');
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

describe('formatZeitKurz (taktisch)', () => {
  it('Uhrzeit 1430 wenn heute, sonst kurze DTG 161430', () => {
    const heute = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
    expect(formatZeitKurz(heute)).toBe(dayjs.utc(heute).local().format('HHmm'));
    const alt = dayjs().utc().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss');
    expect(formatZeitKurz(alt)).toBe(dayjs.utc(alt).local().format('DDHHmm'));
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

describe('formatUhrzeit', () => {
  it('rechnet den UTC-Wirestring in die Zone um', () => {
    expect(formatUhrzeit('2026-06-11 09:00:00', { zeitzone: 'Europe/Berlin' })).toBe('11:00');
  });

  it('liefert den Leerstrich, wenn nichts da ist', () => {
    expect(formatUhrzeit(null)).toBe('——:——');
    expect(formatUhrzeit(undefined)).toBe('——:——');
  });

  it('fällt bei ungültiger Zone auf lokale Zeit zurück statt zu werfen', () => {
    expect(() => formatUhrzeit('2026-06-11 09:00:00', { zeitzone: 'Europe/Brelin' })).not.toThrow();
  });
});

describe('formatUhrzeitMitTag', () => {
  afterEach(() => vi.useRealTimers());

  it('zeigt nur die Uhrzeit, wenn der Zeitpunkt heute liegt (in der Anzeigezone)', () => {
    // Systemzeit 22:00 Berlin am 11.06. — derselbe Tag wie der Wirestring unten.
    vi.setSystemTime(new Date('2026-06-11T20:00:00Z'));
    expect(formatUhrzeitMitTag('2026-06-11 09:00:00', { zeitzone: 'Europe/Berlin' })).toBe('11:00');
  });

  it('stellt den Tag voran, wenn der Zeitpunkt nicht heute liegt (in der Anzeigezone)', () => {
    // Systemzeit 08:00 Berlin am 12.06. — ein Tag nach dem Wirestring unten.
    vi.setSystemTime(new Date('2026-06-12T06:00:00Z'));
    expect(formatUhrzeitMitTag('2026-06-11 09:00:00', { zeitzone: 'Europe/Berlin' })).toBe('11. 11:00');
  });

  it('liefert den Leerstrich, wenn nichts da ist', () => {
    expect(formatUhrzeitMitTag(null)).toBe('——:——');
    expect(formatUhrzeitMitTag(undefined)).toBe('——:——');
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
