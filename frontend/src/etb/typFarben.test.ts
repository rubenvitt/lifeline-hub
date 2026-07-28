import { describe, expect, it } from 'vitest';
import { ERFASSBARE_TYPEN, istNachgetragen } from './typFarben';
import { etbTyp } from '../theme/statusFarben';

describe('typFarben', () => {
  // Die Farbe eines Eintragstyps wird hier NICHT mehr geprüft — sie steht seit
  // LFH-328/A2 im Statusfarb-Vertrag, und `statusFarben.test.ts` prüft dort für jeden
  // Eintrag Rolle und Pflicht-`label`. Was diese Datei weiterhin schuldet, ist die
  // Verbindung der beiden Listen: `ERFASSBARE_TYPEN` ist eine Teilmenge der
  // Vertragsschlüssel, sonst zeigt die Schnellerfassung `undefined` als Option.
  it('hält jeden erfassbaren Typ im Statusfarb-Vertrag', () => {
    for (const t of ERFASSBARE_TYPEN) {
      expect(etbTyp[t]?.label, `${t} ohne Vertragseintrag`).toBeTruthy();
    }
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
