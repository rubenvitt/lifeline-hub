import { describe, expect, it } from 'vitest';
import type { Datenkategorie } from '../api/types';
import { KATEGORIE_TEXT, KATEGORIEN, vorgabeSatz } from './kategorieText';

describe('kategorieText', () => {
  it('deckt jede Kategorie des generierten Typs genau einmal ab, in Server-Reihenfolge', () => {
    const alle: Datenkategorie[] = ['behandlung', 'personenauskunft', 'anhaenge'];
    expect(KATEGORIEN).toEqual(alle);
    expect(Object.keys(KATEGORIE_TEXT).sort()).toEqual([...alle].sort());
  });

  it('jeder Vorschlag nennt eine Quelle und liegt im erlaubten Bereich', () => {
    for (const k of KATEGORIEN) {
      const { vorschlag, bezeichnung, daten } = KATEGORIE_TEXT[k];
      expect(bezeichnung).not.toBe('');
      expect(daten).not.toBe('');
      expect(vorschlag.quelle).toMatch(/§/);
      expect(vorschlag.tage).toBeGreaterThanOrEqual(0);
      expect(vorschlag.tage).toBeLessThanOrEqual(3650);
    }
  });

  it('Anhänge umfassen auch die Bilder der Lagekarte (LFH-997)', () => {
    expect(KATEGORIE_TEXT.anhaenge.daten).toMatch(/Bilder der Lagekarte/);
  });

  it('vorgabeSatz unterscheidet keine Dauer, 0 und eine Zahl', () => {
    expect(vorgabeSatz(null)).toBe('folgt der Frist des Einsatzes');
    expect(vorgabeSatz(0)).toMatch(/sofort/);
    expect(vorgabeSatz(30)).toMatch(/30 Tagen/);
  });
});
