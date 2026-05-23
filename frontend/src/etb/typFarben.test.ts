import { describe, expect, it } from 'vitest';
import { ERFASSBARE_TYPEN, TYP_FARBE, TYP_LABEL, istNachgetragen } from './typFarben';

describe('typFarben', () => {
  it('hat Label und Farbe für jeden erfassbaren Typ', () => {
    expect(TYP_LABEL.meldung).toBe('Meldung');
    expect(TYP_FARBE.berichtigung).toBeTruthy();
  });

  it('schließt system aus den erfassbaren Typen aus', () => {
    expect(ERFASSBARE_TYPEN).not.toContain('system');
    expect(ERFASSBARE_TYPEN).toContain('meldung');
  });
});

describe('istNachgetragen', () => {
  it('false bei kleiner Latenz (< 60 s)', () => {
    expect(istNachgetragen('2026-05-23 10:00:00', '2026-05-23 10:00:03')).toBe(false);
  });

  it('true bei spürbarer Abweichung (>= 60 s)', () => {
    expect(istNachgetragen('2026-05-23 09:30:00', '2026-05-23 10:00:00')).toBe(true);
  });

  it('true bei exakt 60 s (Schwellenwert inklusive)', () => {
    expect(istNachgetragen('2026-05-23 10:00:00', '2026-05-23 10:01:00')).toBe(true);
  });
});
