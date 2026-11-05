/**
 * Regel der Kurzzeile (LLH-1504). Das gerenderte Verhalten über den ganzen Bildlauf misst
 * `e2e/verpflegung-ausgabe.spec.ts` („Handy mit Touch, komfortabel“) am Stab und am Gerät.
 */
import { describe, expect, it } from 'vitest';
import { kurzzeileSichtbar } from './useKurzzeile';

describe('kurzzeileSichtbar', () => {
  it('ohne Bildlauf steht der Anker über dem Band: keine Kurzzeile', () => {
    expect(kurzzeileSichtbar({ top: 164 }, { top: 120 })).toBe(false);
  });

  it('rollt das Band unter die Kante, an der der Anker klebt, steht die Kurzzeile', () => {
    expect(kurzzeileSichtbar({ top: -3 }, { top: 0 })).toBe(true);
  });

  it('beim Einrasten zählen halbe Pixel als Rundung, nicht als Hinausrollen', () => {
    expect(kurzzeileSichtbar({ top: 55.6 }, { top: 56 })).toBe(false);
    expect(kurzzeileSichtbar({ top: 55.4 }, { top: 56 })).toBe(true);
  });
});
