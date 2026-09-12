import { describe, expect, it } from 'vitest';
import { VORLAGEN, vorlage } from './vorlagen';

describe('Lagebericht-Vorlagen', () => {
  it('hat die drei Backend-Vorlagen mit erwarteter Abschnittszahl', () => {
    expect(vorlage('lagebericht')?.abschnitte.length).toBe(7);
    expect(vorlage('lagebeurteilung')?.abschnitte.length).toBe(8);
    expect(vorlage('freitext')?.abschnitte.length).toBe(1);
    expect(vorlage('unsinn' as never)).toBeUndefined();
  });

  it('hat eindeutige Abschnitts-Schlüssel je Vorlage', () => {
    for (const v of VORLAGEN) {
      const keys = v.abschnitte.map((a) => a.schluessel);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('Schlüssel decken sich mit den Backend-Schlüsseln (Drift-Schutz)', () => {
    expect(vorlage('lagebericht')?.abschnitte.map((a) => a.schluessel)).toEqual([
      'auftrag',
      'gefahren_schadenlage',
      'eigene_lage',
      'lageentwicklung',
      'fuehrungsprobleme',
      'antraege_vorschlaege',
      'zusammenfassung',
    ]);
    expect(vorlage('lagebeurteilung')?.abschnitte.map((a) => a.schluessel)).toEqual([
      'auftrag',
      'anlass',
      'beurteilung_schadenlage',
      'beurteilung_eigene_lage',
      'gemeinsame_elemente',
      'entschlussvorschlaege',
      'abwaegen',
      'vorschlag_beste',
    ]);
    expect(vorlage('freitext')?.abschnitte.map((a) => a.schluessel)).toEqual(['text']);
  });
});
