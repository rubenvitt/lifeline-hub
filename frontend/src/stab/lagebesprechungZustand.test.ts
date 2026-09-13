import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { dauerText, lagebesprechungZustand, terminZeitpunkt } from './lagebesprechungZustand';

dayjs.extend(utc);

/** Wire-Form eines absoluten Zeitpunkts — so, wie das Backend ihn schickt (UTC ohne Zone). */
const wire = (iso: string) => dayjs(iso).utc().format('YYYY-MM-DD HH:mm:ss');

describe('dauerText', () => {
  it.each([
    [0, '0 min'],
    [23, '23 min'],
    [59, '59 min'],
    [60, '1 h 00 min'],
    [70, '1 h 10 min'],
    [125, '2 h 05 min'],
  ])('%i Minuten → „%s"', (minuten, text) => {
    expect(dauerText(minuten)).toBe(text);
  });
});

describe('lagebesprechungZustand', () => {
  const jetzt = dayjs('2026-09-13T10:00:00Z');

  it('ohne Termin: „kein Termin", neutral', () => {
    for (const leer of [undefined, null, '']) {
      expect(lagebesprechungZustand(leer, jetzt)).toEqual({
        rolle: 'neutral',
        label: 'kein Termin',
      });
    }
  });

  it('ein unlesbarer Termin behauptet NICHT „kein Termin"', () => {
    expect(lagebesprechungZustand('kaputt', jetzt)).toEqual({
      rolle: 'neutral',
      label: 'Termin unlesbar',
    });
  });

  it('zukünftig: „in 23 min", neutral — auf ganze Minuten abgerundet', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T10:23:59Z'), jetzt)).toEqual({
      rolle: 'neutral',
      label: 'in 23 min',
    });
  });

  it('zukünftig ab 60 min mit Stunden', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T12:05:00Z'), jetzt).label).toBe('in 2 h 05 min');
  });

  it('vergangen: „seit 5 min überfällig", achtung', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T09:54:30Z'), jetzt)).toEqual({
      rolle: 'achtung',
      label: 'seit 5 min überfällig',
    });
  });

  it('überfällig ab 60 min mit Stunden', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T08:50:00Z'), jetzt).label).toBe(
      'seit 1 h 10 min überfällig',
    );
  });

  /** Ruling 12: unter einer Minute sagte „in 0 min"/„seit 0 min überfällig" nichts Lesbares. */
  it('genau am Termin „jetzt fällig" (achtung) — eine Sekunde davor „in < 1 min" (neutral)', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T10:00:00Z'), jetzt)).toEqual({
      rolle: 'achtung',
      label: 'jetzt fällig',
    });
    expect(lagebesprechungZustand(wire('2026-09-13T10:00:01Z'), jetzt)).toEqual({
      rolle: 'neutral',
      label: 'in < 1 min',
    });
  });

  it('ab einer vollen Minute der bisherige Wortlaut — 59 s bleiben unter der Grenze', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T09:59:01Z'), jetzt)).toEqual({
      rolle: 'achtung',
      label: 'jetzt fällig',
    });
    expect(lagebesprechungZustand(wire('2026-09-13T09:59:00Z'), jetzt)).toEqual({
      rolle: 'achtung',
      label: 'seit 1 min überfällig',
    });
    expect(lagebesprechungZustand(wire('2026-09-13T10:00:59Z'), jetzt)).toEqual({
      rolle: 'neutral',
      label: 'in < 1 min',
    });
    expect(lagebesprechungZustand(wire('2026-09-13T10:01:00Z'), jetzt)).toEqual({
      rolle: 'neutral',
      label: 'in 1 min',
    });
  });
});

/**
 * Beidseits beider Sommerzeitgrenzen (29.03.2026 und 25.10.2026, je 01:00Z).
 *
 * Vitest setzt KEIN `TZ` (`vite.config.ts`, test-Block): in einer UTC-Umgebung ist ein lokaler
 * Parse (`dayjs(s)` statt `dayjs.utc(s)`) vom richtigen nicht zu unterscheiden. Die tragende
 * Zeile ist deshalb der Vergleich gegen den ABSOLUTEN Zeitpunkt (Muster `etb/filterZeit.test.ts`);
 * auf einer Maschine in Europe/Berlin wird ein lokaler Parse hier rot. Im Gate ist das
 * zugesichert: `scripts/check-all.sh` setzt `TZ=Europe/Berlin` (Ruling 2, LFH-543-Ledger).
 */
describe('lagebesprechungZustand an den Sommerzeitgrenzen', () => {
  it.each([
    '2026-03-29T00:30:00Z',
    '2026-03-29T01:30:00Z',
    '2026-10-25T00:30:00Z',
    '2026-10-25T01:30:00Z',
  ])('liest %s als UTC-Zeitpunkt', (iso) => {
    expect(terminZeitpunkt(wire(iso))!.valueOf()).toBe(dayjs(iso).valueOf());
  });

  it('März: rechnet in echten Minuten, nicht in Wanduhrzeit', () => {
    // 00:30Z = 01:30 MEZ, 01:30Z = 03:30 MESZ — auf der Wanduhr 2 h, tatsächlich 1 h.
    expect(
      lagebesprechungZustand(wire('2026-03-29T01:30:00Z'), dayjs('2026-03-29T00:30:00Z')).label,
    ).toBe('in 1 h 00 min');
    expect(
      lagebesprechungZustand(wire('2026-03-29T00:30:00Z'), dayjs('2026-03-29T01:30:00Z')).label,
    ).toBe('seit 1 h 00 min überfällig');
  });

  it('Oktober: rechnet in echten Minuten, nicht in Wanduhrzeit', () => {
    // 00:30Z = 02:30 MESZ, 01:30Z = 02:30 MEZ — auf der Wanduhr 0 h, tatsächlich 1 h.
    expect(
      lagebesprechungZustand(wire('2026-10-25T01:30:00Z'), dayjs('2026-10-25T00:30:00Z')).label,
    ).toBe('in 1 h 00 min');
    expect(
      lagebesprechungZustand(wire('2026-10-25T00:30:00Z'), dayjs('2026-10-25T01:30:00Z')).label,
    ).toBe('seit 1 h 00 min überfällig');
  });
});
