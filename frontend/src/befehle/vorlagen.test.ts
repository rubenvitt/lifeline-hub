import { describe, it, expect } from 'vitest';
import { VORLAGEN, vorlage } from './vorlagen';

describe('Befehlsvorlagen', () => {
  it('hat die vier Schemata mit erwarteter Abschnittszahl (Sync zu Backend)', () => {
    expect(vorlage('befehl_lad')!.abschnitte).toHaveLength(3);
    expect(vorlage('befehl_ladef')!.abschnitte).toHaveLength(5);
    expect(vorlage('befehl_schnee')!.abschnitte).toHaveLength(5);
    expect(vorlage('befehl_ea_zmw')!.abschnitte).toHaveLength(4);
  });

  it('hat eindeutige Schlüssel je Vorlage', () => {
    for (const v of VORLAGEN) {
      const keys = v.abschnitte.map((a) => a.schluessel);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('LADEF beginnt mit Lage und endet mit Führung/Kommunikation (Reihenfolge)', () => {
    const ks = vorlage('befehl_ladef')!.abschnitte.map((a) => a.schluessel);
    expect(ks[0]).toBe('lage');
    expect(ks[ks.length - 1]).toBe('fuehrung_kommunikation');
  });
});
