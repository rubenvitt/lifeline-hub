import { describe, expect, it } from 'vitest';
import type { Staerke } from '../api/types';
import { staerkeImRaum } from './brZahlen';

type E = {
  id: number;
  ueber_einheit_id?: number | null;
  ist_kumuliert: Staerke;
};

const st = (fuehrer: number, unterfuehrer: number, mannschaft: number): Staerke => ({
  fuehrer,
  unterfuehrer,
  mannschaft,
});

describe('Stärke im Raum (LLH-1095 D1)', () => {
  const zug: E = { id: 10, ist_kumuliert: st(0, 1, 3) };
  const trupp: E = { id: 11, ist_kumuliert: st(0, 0, 2) };
  const gruppe: E = { id: 12, ueber_einheit_id: 10, ist_kumuliert: st(0, 1, 2) };

  it('summiert die Einheiten im Raum', () => {
    expect(staerkeImRaum([10, 11], [zug, trupp, gruppe])).toEqual({
      staerke: st(0, 1, 5),
      unvollstaendig: false,
    });
  });

  it('zählt eine Untereinheit nicht doppelt, wenn ihre Obereinheit mit im Raum steht', () => {
    expect(staerkeImRaum([10, 12], [zug, trupp, gruppe]).staerke).toEqual(st(0, 1, 3));
  });

  it('fehlende Einheit: unvollständig, keine zu kleine Zahl', () => {
    expect(staerkeImRaum([10, 99], [zug, trupp])).toEqual({
      staerke: null,
      unvollstaendig: true,
    });
  });

  it('ohne Einheitenliste (Fehler, keine Freigabe): unvollständig', () => {
    expect(staerkeImRaum([10], undefined)).toEqual({ staerke: null, unvollstaendig: true });
  });

  it('leerer Raum: keine Stärke, aber nicht unvollständig', () => {
    expect(staerkeImRaum([], [zug])).toEqual({ staerke: null, unvollstaendig: false });
    expect(staerkeImRaum([], undefined)).toEqual({ staerke: null, unvollstaendig: false });
  });
});
