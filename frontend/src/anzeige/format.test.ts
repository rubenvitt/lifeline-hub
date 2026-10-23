import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { formatDtg, MONATE_DTG, formatKoordinate, formatDistanz } from './format';

dayjs.extend(utc);
dayjs.extend(timezone);

describe('formatKoordinate', () => {
  it('Default = WGS84 dezimal toFixed(5) (byte-identisch zu früher)', () => {
    expect(formatKoordinate(53.855, 8.0816667)).toBe('53.85500, 8.08167');
    expect(formatKoordinate(53.855, 8.0816667, { koordinatenformat: 'wgs84' })).toBe(
      '53.85500, 8.08167',
    );
  });

  it('MGRS-Konvention → MGRS-String', () => {
    expect(formatKoordinate(51.1, 4.1, { koordinatenformat: 'mgrs' })).toBe('31U ES 77019 61520');
  });

  it('UTM-Konvention → Zone/Band + gerundete Ostung/Nordung', () => {
    expect(formatKoordinate(51.1, 4.1, { koordinatenformat: 'utm' })).toBe('31U 577020 5661521');
  });

  it('formatiert dms über die Konvention', () => {
    expect(formatKoordinate(51.5, 10.25, { koordinatenformat: 'dms' })).toBe(
      '51°30\'00"N 010°15\'00"E',
    );
  });

  it('formatiert gk über die Konvention', () => {
    expect(formatKoordinate(48.782, 9.177, { koordinatenformat: 'gk' })).toMatch(
      /^R 35\d{5} {2}H 5\d{6}$/,
    );
  });

  it('WGS84-Default bleibt byte-exakt', () => {
    expect(formatKoordinate(51.1604, 10.4514)).toBe('51.16040, 10.45140');
  });
});

describe('formatDistanz', () => {
  it('metrisch (Default): m bzw. km', () => {
    expect(formatDistanz(450)).toBe('450 m');
    expect(formatDistanz(1500)).toBe('1,50 km');
    expect(formatDistanz(1200)).toBe('1,20 km');
  });

  it('imperial: ft bzw. mi', () => {
    expect(formatDistanz(100, { einheiten: 'imperial' })).toBe('328 ft');
    expect(formatDistanz(5000, { einheiten: 'imperial' })).toBe('3,11 mi');
  });
});

describe('formatDtg (DTG nach FwDV/DV 810, Entscheidung E1)', () => {
  it('schreibt Tag, Uhrzeit, Monat klein ohne Umlaut und zweistelliges Jahr in der Zone', () => {
    expect(formatDtg(dayjs.utc('2026-03-16 13:30:00'), 'Europe/Berlin')).toBe('161430mrz26');
    expect(formatDtg(dayjs.utc('2026-10-17 12:30:00'), 'Europe/Berlin')).toBe('171430okt26');
  });

  it('kennt alle zwölf Monatskürzel', () => {
    const kuerzel = Array.from({ length: 12 }, (_, i) =>
      formatDtg(dayjs.utc(`2026-${String(i + 1).padStart(2, '0')}-10 12:00:00`), 'UTC').slice(6, 9),
    );
    expect(kuerzel).toEqual(MONATE_DTG);
    expect(MONATE_DTG).toEqual([
      'jan',
      'feb',
      'mrz',
      'apr',
      'mai',
      'jun',
      'jul',
      'aug',
      'sep',
      'okt',
      'nov',
      'dez',
    ]);
  });

  it('nimmt beim Jahreswechsel Tag, Monat und Jahr der Anzeigezone', () => {
    expect(formatDtg(dayjs.utc('2026-12-31 23:30:00'), 'Europe/Berlin')).toBe('010030jan27');
  });

  it('bleibt taktisch: das Zeitfeld zeigt immer die DTG (Spec `zeiteingabe`)', () => {
    expect(formatDtg(dayjs.utc('2026-10-17 12:30:00'), 'Europe/Berlin')).toBe('171430okt26');
  });
});
