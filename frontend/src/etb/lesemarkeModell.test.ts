import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EtbLesemarke } from '../api/types';
import { lesemarkeImFenster, lesemarkeLinie, lesemarkeText } from './lesemarkeModell';

const BERLIN = { zeitzone: 'Europe/Berlin' };

function marke(over: Partial<EtbLesemarke>): EtbLesemarke {
  return { neue_anzahl: 0, hoechste_lfd_nr: 20, ...over };
}

describe('lesemarkeText', () => {
  afterEach(() => vi.useRealTimers());

  it('schweigt, wenn nichts Fremdes über der Marke liegt', () => {
    expect(
      lesemarkeText(marke({ gesichtet_at: '2026-09-22 11:04:00', gesichtet_lfd_nr: 20 }), BERLIN),
    ).toBeNull();
  });

  it('schweigt bei leerem Tagebuch — es gäbe nichts zu markieren', () => {
    expect(lesemarkeText({ neue_anzahl: 3 }, BERLIN)).toBeNull();
  });

  it('nennt Anzahl und Uhrzeit der letzten Sichtung in der Anzeigezone', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
    // 11:04 UTC ist 13:04 in Berlin (Sommerzeit) — derselbe Tag.
    expect(
      lesemarkeText(
        marke({ neue_anzahl: 14, gesichtet_at: '2026-09-22 11:04:00', gesichtet_lfd_nr: 6 }),
        BERLIN,
      ),
    ).toBe('14 neue Einträge seit Ihrer letzten Sichtung um 13:04');
  });

  it('nennt den Tag, wenn die Sichtung nicht von heute ist', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
    expect(
      lesemarkeText(
        marke({ neue_anzahl: 1, gesichtet_at: '2026-09-21 20:30:00', gesichtet_lfd_nr: 6 }),
        BERLIN,
      ),
    ).toBe('1 neuer Eintrag seit Ihrer letzten Sichtung am 21.09. um 22:30');
  });

  it('behauptet ohne Marke keine Sichtung, die es nie gab', () => {
    expect(lesemarkeText(marke({ neue_anzahl: 412 }), BERLIN)).toBe(
      '412 Einträge, die Sie noch nicht gesichtet haben',
    );
    expect(lesemarkeText(marke({ neue_anzahl: 1 }), BERLIN)).toBe(
      '1 Eintrag, den Sie noch nicht gesichtet haben',
    );
  });
});

describe('lesemarkeLinie und lesemarkeImFenster (LLH-1149)', () => {
  afterEach(() => vi.useRealTimers());

  it('nennt Uhrzeit taktisch und Anzahl', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
    expect(
      lesemarkeLinie(
        marke({ neue_anzahl: 14, gesichtet_at: '2026-09-22 11:04:00', gesichtet_lfd_nr: 6 }),
        BERLIN,
      ),
    ).toBe('Neu seit 1304 · 14 Einträge');
    expect(
      lesemarkeLinie(
        marke({ neue_anzahl: 1, gesichtet_at: '2026-09-21 20:30:00', gesichtet_lfd_nr: 6 }),
        BERLIN,
      ),
    ).toBe('Neu seit 212230 · 1 Eintrag');
  });

  it('hat ohne Marke keinen Ort', () => {
    expect(lesemarkeLinie(marke({ neue_anzahl: 3 }), BERLIN)).toBeNull();
  });

  it('steht nur ohne Filter, mit geladener Marke und Neuerem dahinter in der Achse', () => {
    const m = marke({ neue_anzahl: 2, gesichtet_lfd_nr: 5 });
    expect(lesemarkeImFenster(m, [4, 5, 6, 7], false)).toBe(true);
    expect(lesemarkeImFenster(m, [4, 5, 6, 7], true)).toBe(false);
    expect(lesemarkeImFenster(m, [6, 7], false)).toBe(false);
    expect(lesemarkeImFenster(m, [4, 5], false)).toBe(false);
    expect(lesemarkeImFenster(marke({ neue_anzahl: 0, gesichtet_lfd_nr: 5 }), [5, 6], false)).toBe(
      false,
    );
  });
});
