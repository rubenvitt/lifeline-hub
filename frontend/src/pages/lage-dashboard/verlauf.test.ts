import { describe, expect, it } from 'vitest';
import type { Person } from '../../api/types';
import { VERLAUF_STUNDEN, ablesung, anlassTon, kontakteJeStunde } from './verlauf';

const BERLIN = { zeitzone: 'Europe/Berlin' };
/** 2026-06-11 12:20:00 UTC = 14:20 in Berlin (Sommerzeit). */
const JETZT = Date.UTC(2026, 5, 11, 12, 20, 0);

const p = (erfasst_at: string, extra: Partial<Person> = {}) =>
  ({ status: 'betroffen', anlass: null, erfasst_at, ...extra }) as Person;

describe('kontakteJeStunde (LLH-1574)', () => {
  it('festes Fenster von zwölf Stunden, das mit der laufenden Stunde der Anzeigezone endet', () => {
    const v = kontakteJeStunde([], JETZT, BERLIN);
    expect(v.stunden).toHaveLength(VERLAUF_STUNDEN);
    expect(v.stunden.map((s) => s.stunde)).toEqual([
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '11',
      '12',
      '13',
      '14',
    ]);
    expect(v.stunden[VERLAUF_STUNDEN - 1].laufend).toBe(true);
    expect(v.stunden.filter((s) => s.laufend)).toHaveLength(1);
    expect(v.spitze).toBeNull();
    expect(v.imFenster).toBe(0);
  });

  it('ordnet nach erfasst_at zu, stapelt nach Anlass-Ton und lässt Vermisste weg', () => {
    const v = kontakteJeStunde(
      [
        p('2026-06-11 12:05:00', { anlass: 'verletzung' }), // 14 Uhr
        p('2026-06-11 12:19:59', { anlass: 'allergie' }), // 14 Uhr, Übrige
        p('2026-06-11 11:59:59', { anlass: 'intoxikation' }), // 13 Uhr
        p('2026-06-11 11:00:00'), // 13 Uhr, ohne Anlass → Übrige
        p('2026-06-11 11:30:00', { status: 'vermisst' }),
        p('2026-06-11 00:59:59'), // vor dem Fenster (02 Uhr)
        p('2026-06-11 12:30:00'), // nach jetzt
      ],
      JETZT,
      BERLIN,
    );
    const jetzt = v.stunden[VERLAUF_STUNDEN - 1];
    const davor = v.stunden[VERLAUF_STUNDEN - 2];
    expect(jetzt.gesamt).toBe(2);
    expect(jetzt.je).toMatchObject({ verletzung: 1, uebrige: 1 });
    expect(davor.gesamt).toBe(2);
    expect(davor.je).toMatchObject({ intoxikation: 1, uebrige: 1 });
    expect(v.imFenster).toBe(4);
    // Gleichstand: die jüngere Stunde ist die Spitze.
    expect(v.spitze).toBe(jetzt);
  });

  it('vier Anlässe tragen einen eigenen Ton, alle übrigen und „ohne“ teilen sich „Übrige“', () => {
    expect(anlassTon('verletzung')).toBe('verletzung');
    expect(anlassTon('hitze_kaelte')).toBe('hitze_kaelte');
    expect(anlassTon('psychisch')).toBe('uebrige');
    expect(anlassTon(null)).toBe('uebrige');
  });

  it('die Ablesung nennt jeden Anlass einzeln, „ohne Anlass“ zuletzt', () => {
    const v = kontakteJeStunde(
      [
        p('2026-06-11 12:05:00', { anlass: 'psychisch' }),
        p('2026-06-11 12:06:00', { anlass: 'verletzung' }),
        p('2026-06-11 12:07:00'),
      ],
      JETZT,
      BERLIN,
    );
    expect(ablesung(v.stunden[VERLAUF_STUNDEN - 1])).toBe(
      '14 Uhr (laufend): 3 Kontakte · Verletzung 1 · Psychisch 1 · ohne Anlass 1',
    );
    expect(ablesung(v.stunden[0])).toBe('03 Uhr: 0 Kontakte');
  });
});
