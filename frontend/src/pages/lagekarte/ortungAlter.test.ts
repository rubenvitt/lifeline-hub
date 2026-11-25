import { describe, expect, it } from 'vitest';
import { ORTUNG_VERALTET_NACH_MIN, ortungStand } from './ortungAlter';

const JETZT = Date.UTC(2026, 10, 25, 12, 0, 0);
const vor = (sekunden: number) => new Date(JETZT - sekunden * 1000).toISOString();

describe('ortungStand', () => {
  it('nennt die Schwelle von 10 Minuten', () => {
    expect(ORTUNG_VERALTET_NACH_MIN).toBe(10);
  });

  it('gilt bei genau 10 Minuten noch nicht als veraltet', () => {
    const s = ortungStand({ position_quelle: 'ortung', position_gemessen_at: vor(600) }, JETZT);
    expect(s).toEqual({ quelle: 'gps', veraltet: false, alterText: 'vor 10 min' });
  });

  it('gilt bei 10 Minuten und einer Sekunde als veraltet', () => {
    const s = ortungStand({ position_quelle: 'ortung', position_gemessen_at: vor(601) }, JETZT);
    expect(s.veraltet).toBe(true);
    expect(s.alterText).toBe('vor 10 min');
  });

  it('zeigt das Alter in Worten', () => {
    const s = ortungStand({ position_quelle: 'ortung', position_gemessen_at: vor(180) }, JETZT);
    expect(s.alterText).toBe('vor 3 min');
  });

  it('altert eine manuelle Position nie und nennt kein Alter', () => {
    const s = ortungStand({ position_quelle: 'manuell', position_gemessen_at: vor(99_999) }, JETZT);
    expect(s).toEqual({ quelle: 'manuell', veraltet: false, alterText: null });
  });

  it('zeigt ohne Quelle nichts', () => {
    expect(ortungStand({ position_quelle: null, position_gemessen_at: null }, JETZT)).toEqual({
      quelle: null,
      veraltet: false,
      alterText: null,
    });
    expect(ortungStand({}, JETZT).quelle).toBeNull();
  });

  it('rät bei GPS ohne Messzeit kein Alter', () => {
    const s = ortungStand({ position_quelle: 'ortung', position_gemessen_at: null }, JETZT);
    expect(s).toEqual({ quelle: 'gps', veraltet: false, alterText: null });
  });
});
