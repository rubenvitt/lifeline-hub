import { describe, expect, it } from 'vitest';
import type { WetterWarnung } from '../api/types';
import { kopfWarnung } from './kopfWarnung';

/** 2026-10-04 10:00 UTC = 12:00 in Berlin (Anzeigezone der Vorgabe-Konventionen). */
const JETZT = Date.UTC(2026, 9, 4, 10, 0, 0);
const MIN = 60_000;
const um = (ms: number) => new Date(JETZT + ms).toISOString();

const warnung = (over: Partial<WetterWarnung>): WetterWarnung => ({
  stufe: 'maessig',
  ereignis: 'STURMBÖEN',
  ueberschrift: 'x',
  beginn: um(-60 * MIN),
  ende: um(120 * MIN),
  ...over,
});

const teil = (daten: WetterWarnung[], abgerufenVor = 2 * MIN) => ({
  zustand: 'ok',
  abgerufen_at: um(-abgerufenVor),
  daten,
});

describe('kopfWarnung (LLH-1117)', () => {
  it('eine angekündigte Unwetterwarnung: Stufe als Wort, Ereignis, „ab“', () => {
    const k = kopfWarnung(
      teil([
        warnung({ stufe: 'schwer', ereignis: 'STARKREGEN', beginn: um(6 * 60 * MIN + 11 * MIN) }),
      ]),
      JETZT,
    );
    expect(k).toEqual({
      stufe: 'schwer',
      stufenwort: 'Unwetterwarnung',
      text: 'Starkregen ab 18:11',
      weitere: 0,
    });
  });

  it('eine geltende Warnung nennt ihr Ende, ohne Ende „bis auf Weiteres“', () => {
    expect(kopfWarnung(teil([warnung({})]), JETZT)?.text).toBe('Sturmböen bis 14:00');
    expect(kopfWarnung(teil([warnung({ ende: null })]), JETZT)?.text).toBe(
      'Sturmböen bis auf Weiteres',
    );
  });

  it('nennt die höchste Stufe, zählt die übrigen', () => {
    const k = kopfWarnung(
      teil([
        warnung({ stufe: 'gering', ereignis: 'FROST' }),
        warnung({ stufe: 'extrem', ereignis: 'ORKAN', beginn: um(3 * 60 * MIN) }),
        warnung({ stufe: 'schwer', ereignis: 'GEWITTER' }),
      ]),
      JETZT,
    );
    expect(k?.stufe).toBe('extrem');
    expect(k?.stufenwort).toBe('Extremes Unwetter');
    expect(k?.text).toBe('Orkan ab 15:00');
    expect(k?.weitere).toBe(2);
  });

  it('bei gleicher Stufe die geltende vor der angekündigten, dann der früheste Beginn', () => {
    const angekuendigt = warnung({ stufe: 'schwer', ereignis: 'HAGEL', beginn: um(30 * MIN) });
    const gilt = warnung({ stufe: 'schwer', ereignis: 'GEWITTER', beginn: um(-10 * MIN) });
    const frueher = warnung({ stufe: 'schwer', ereignis: 'STARKREGEN', beginn: um(-50 * MIN) });
    expect(kopfWarnung(teil([angekuendigt, gilt]), JETZT)?.text).toMatch(/^Gewitter/);
    expect(kopfWarnung(teil([gilt, frueher]), JETZT)?.text).toMatch(/^Starkregen/);
  });

  it('jede amtliche Stufe zählt, auch „Wetterwarnung“', () => {
    expect(
      kopfWarnung(teil([warnung({ stufe: 'gering', ereignis: 'FROST' })]), JETZT),
    ).toMatchObject({ stufenwort: 'Wetterwarnung', text: 'Frost bis 14:00' });
  });

  it('Abwesenheit: keine Warnung, nur abgelaufene, kein Teil, kein Ort, Ausfall, zu alter Stand', () => {
    expect(kopfWarnung(teil([]), JETZT)).toBeNull();
    expect(kopfWarnung(teil([warnung({ ende: um(-MIN) })]), JETZT)).toBeNull();
    expect(kopfWarnung(undefined, JETZT)).toBeNull();
    expect(kopfWarnung({ zustand: 'kein_ort' }, JETZT)).toBeNull();
    expect(kopfWarnung({ zustand: 'ausfall' }, JETZT)).toBeNull();
    expect(kopfWarnung(teil([warnung({})], 7 * 60 * MIN), JETZT)).toBeNull();
  });

  it('ein veralteter, noch verwertbarer Stand zeigt die Marke weiter', () => {
    expect(kopfWarnung(teil([warnung({})], 45 * MIN), JETZT)).not.toBeNull();
  });
});
