import { describe, expect, it } from 'vitest';
import { berichtigtDurch, berichtigtText, juengsteBerichtigung } from './berichtigung';

describe('Berichtigungen eines Eintrags (LLH-1321)', () => {
  const zwei = {
    berichtigt_durch: [
      { id: 10, lfd_nr: 7 },
      { id: 30, lfd_nr: 12 },
    ],
  };

  it('ordnet die jüngste zuerst', () => {
    expect(berichtigtDurch(zwei).map((b) => b.lfd_nr)).toEqual([12, 7]);
    expect(juengsteBerichtigung(zwei)).toEqual({ id: 30, lfd_nr: 12 });
  });

  it('kennt ohne Feld (Gerätespeicher von vor LFH-689) und bei leerer Liste keine', () => {
    expect(juengsteBerichtigung({})).toBeUndefined();
    expect(juengsteBerichtigung({ berichtigt_durch: [] })).toBeUndefined();
    expect(berichtigtText({})).toBeNull();
  });

  it('nennt im Klartext die jüngste Berichtigung', () => {
    expect(berichtigtText(zwei)).toBe('berichtigt → Nr. 12');
  });
});
