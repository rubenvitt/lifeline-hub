import { describe, it, expect, vi, afterEach } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  formatDtg,
  MONATE_DTG,
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

// Die alten Namen leiten auf die Rollen aus `zeitDarstellung.ts` weiter (LLH-1053); dort stehen
// die ausführlichen Fälle. Hier nur, dass jede Weiterleitung die richtige Rolle trifft.
describe('alte Zeitformatierer leiten auf die Rollen weiter', () => {
  const wire = '2026-07-16 12:30:00'; // 16.07.2026 14:30 Berlin
  const berlin = { zeitzone: 'Europe/Berlin' };
  const datum = { zeitzone: 'Europe/Berlin', zeitdarstellung: 'datum_uhrzeit' as const };

  it('taktischeUhrzeit → uhrzeit', () => {
    expect(taktischeUhrzeit(wire, berlin)).toBe('1430');
    expect(taktischeUhrzeit(wire, datum)).toBe('14:30');
  });
  it('taktischeDtg → Tag und Uhrzeit ohne Heute-Prüfung (rein)', () => {
    expect(taktischeDtg(wire, berlin)).toBe('161430');
    expect(taktischeDtg(wire, datum)).toBe('16.07. 14:30');
  });
  it('taktischeDtgVoll und formatZeit → zeitpunkt', () => {
    expect(taktischeDtgVoll(wire, berlin)).toBe('161430jul26');
    expect(formatZeit(wire, berlin)).toBe('161430jul26');
    expect(formatZeit(wire, datum)).toBe('16.07.26 14:30');
    // März ohne Umlaut (E1).
    expect(taktischeDtgVoll('2026-03-01 06:00:00', berlin)).toBe('010700mrz26');
  });
  it('leer/null → leerer String', () => {
    expect(taktischeUhrzeit(null, DEFAULT_KONVENTIONEN)).toBe('');
    expect(taktischeDtgVoll(undefined, DEFAULT_KONVENTIONEN)).toBe('');
    expect(formatZeit('', DEFAULT_KONVENTIONEN)).toBe('');
  });
  it('ungültige Zeitzone crasht nicht, fällt auf lokal zurück (Review LFH-136)', () => {
    const lokal = formatZeit(wire, DEFAULT_KONVENTIONEN);
    expect(() => formatZeit(wire, { zeitzone: 'Europe/Brelin' })).not.toThrow();
    expect(formatZeit(wire, { zeitzone: 'Müll/Quatsch' })).toBe(lokal);
  });
});

describe('formatZeitKurz → zeitKurz', () => {
  afterEach(() => vi.useRealTimers());
  it('heute nur die Uhrzeit, sonst Tag und Uhrzeit', () => {
    vi.setSystemTime(new Date('2026-07-16T18:00:00Z'));
    expect(formatZeitKurz('2026-07-16 12:30:00', { zeitzone: 'Europe/Berlin' })).toBe('1430');
    expect(formatZeitKurz('2026-07-13 12:30:00', { zeitzone: 'Europe/Berlin' })).toBe('131430');
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

describe('formatUhrzeit → uhrzeit', () => {
  it('rechnet den UTC-Wirestring in die Zone um, in der wirksamen Darstellung', () => {
    expect(formatUhrzeit('2026-06-11 09:00:00', { zeitzone: 'Europe/Berlin' })).toBe('1100');
    expect(
      formatUhrzeit('2026-06-11 09:00:00', {
        zeitzone: 'Europe/Berlin',
        zeitdarstellung: 'datum_uhrzeit',
      }),
    ).toBe('11:00');
  });

  it('liefert einen Leerstrich in Ziffernbreite, wenn nichts da ist', () => {
    expect(formatUhrzeit(null, DEFAULT_KONVENTIONEN)).toBe('————');
    expect(formatUhrzeit(undefined, { zeitdarstellung: 'datum_uhrzeit' })).toBe('——:——');
  });

  it('fällt bei ungültiger Zone auf lokale Zeit zurück statt zu werfen', () => {
    expect(() => formatUhrzeit('2026-06-11 09:00:00', { zeitzone: 'Europe/Brelin' })).not.toThrow();
  });
});

describe('formatUhrzeitMitTag → zeitKurz', () => {
  afterEach(() => vi.useRealTimers());

  it('zeigt nur die Uhrzeit, wenn der Zeitpunkt heute liegt (in der Anzeigezone)', () => {
    // Systemzeit 22:00 Berlin am 11.06. — derselbe Tag wie der Wirestring unten.
    vi.setSystemTime(new Date('2026-06-11T20:00:00Z'));
    expect(formatUhrzeitMitTag('2026-06-11 09:00:00', { zeitzone: 'Europe/Berlin' })).toBe('1100');
  });

  it('stellt den Tag voran, wenn der Zeitpunkt nicht heute liegt (in der Anzeigezone)', () => {
    // Systemzeit 08:00 Berlin am 12.06. — ein Tag nach dem Wirestring unten.
    vi.setSystemTime(new Date('2026-06-12T06:00:00Z'));
    expect(formatUhrzeitMitTag('2026-06-11 09:00:00', { zeitzone: 'Europe/Berlin' })).toBe(
      '111100',
    );
    expect(
      formatUhrzeitMitTag('2026-06-11 09:00:00', {
        zeitzone: 'Europe/Berlin',
        zeitdarstellung: 'datum_uhrzeit',
      }),
    ).toBe('11.06. 11:00');
  });

  it('liefert den Leerstrich, wenn nichts da ist', () => {
    expect(formatUhrzeitMitTag(null, DEFAULT_KONVENTIONEN)).toBe('————');
    expect(formatUhrzeitMitTag(undefined, DEFAULT_KONVENTIONEN)).toBe('————');
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
