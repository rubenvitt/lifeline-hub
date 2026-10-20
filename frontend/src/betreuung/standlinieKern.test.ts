import { describe, expect, it } from 'vitest';
import type { StandVerlaufEintrag } from '../api/types';
import { standStufen, stufenAussage, stufenGeometrie } from './standlinieKern';

const eintrag = (
  over: Partial<StandVerlaufEintrag> & { id: number; zeitpunkt_at: string },
): StandVerlaufEintrag => ({
  aktuell: false,
  erfasst_at: over.zeitpunkt_at,
  erfasst_von: 'Leitung',
  erhebung: 'gezaehlt',
  evakuiert: 0,
  ...over,
});

describe('standStufen (LLH-1076)', () => {
  it('nimmt keine zurückgenommene Meldung und ordnet nach Zeitpunkt, älteste zuerst', () => {
    const s = standStufen([
      eintrag({ id: 3, zeitpunkt_at: '2026-10-20 12:00:00', evakuiert: 300, aktuell: true }),
      eintrag({
        id: 2,
        zeitpunkt_at: '2026-10-20 11:00:00',
        evakuiert: 999,
        zurueckgenommen_at: '2026-10-20 11:05:00',
      }),
      eintrag({
        id: 1,
        zeitpunkt_at: '2026-10-20 10:00:00',
        evakuiert: 100,
        erhebung: 'geschaetzt',
      }),
    ]);
    expect(s.map((p) => p.evakuiert)).toEqual([100, 300]);
    expect(s[0].geschaetzt).toBe(true);
    expect(s[0].t).toBe(Date.UTC(2026, 9, 20, 10, 0, 0));
  });
});

describe('stufenGeometrie (LLH-1076)', () => {
  const stufen = standStufen([
    eintrag({ id: 1, zeitpunkt_at: '2026-10-20 10:00:00', evakuiert: 100 }),
    eintrag({ id: 2, zeitpunkt_at: '2026-10-20 11:00:00', evakuiert: 300 }),
    eintrag({ id: 3, zeitpunkt_at: '2026-10-20 12:00:00', evakuiert: 200 }),
  ]);

  it('Stufen statt Schrägen: waagerecht bis zur nächsten Meldung, dann senkrecht', () => {
    const g = stufenGeometrie(stufen, 400, 200, 100)!;
    expect(g.d).toMatch(/^M 0 [\d.]+ H 100 V [\d.]+ H 200 V [\d.]+$/);
    // Die Linie endet an der jüngsten Meldung, nicht später.
    expect(g.punkte[g.punkte.length - 1].x).toBe(200);
  });

  it('y beginnt bei 0 und reicht über Plangröße und Stand', () => {
    const g = stufenGeometrie(stufen, 400, 200, 100)!;
    // oben = 400 · 1,1 = 440 → Plan bei 100 − 400/440·100
    expect(g.planY).toBeCloseTo(9.09, 1);
    expect(g.punkte[0].y).toBeCloseTo(100 - (100 / 440) * 100, 1);
    // Liegt der Stand über der Plangröße, bestimmt er die Achse.
    const ueber = stufenGeometrie(stufen, 150, 200, 100)!;
    expect(Math.min(...ueber.punkte.map((p) => p.y))).toBeGreaterThan(0);
  });

  it('weniger als zwei Meldungen oder keine Zeitspanne: keine Linie', () => {
    expect(stufenGeometrie(stufen.slice(0, 1), 400, 200, 100)).toBeNull();
    expect(
      stufenGeometrie([stufen[0], { ...stufen[1], t: stufen[0].t }], 400, 200, 100),
    ).toBeNull();
  });

  it('Aussage nennt Anfang, Ende, Zahl der Meldungen und Plangröße, „etwa“ bei geschätzt', () => {
    expect(
      stufenAussage([stufen[0], { ...stufen[2], geschaetzt: true }], 400, '1000', '1200'),
    ).toBe('Stand evakuiert von 100 (1000) auf etwa 200 (1200), 2 Meldungen, Plangröße 400');
  });
});
