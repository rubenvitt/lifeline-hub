import { describe, expect, it } from 'vitest';
import { mitVorgabe, orgVorgabe, typVorgabe } from './vorgabeText';

describe('vorgabeText — ein Wortlaut für voreingestellte Werte (LFH-944)', () => {
  it('setzt „(Vorgabe)“ hinter den System-Wert im Platzhalter', () => {
    expect(mitVorgabe('24 Stunden')).toBe('24 Stunden (Vorgabe)');
  });

  it('nennt die Organisation als Herkunft im Einsatz', () => {
    expect(orgVorgabe('24 Stunden')).toBe('Vorgabe der Organisation: 24 Stunden');
  });

  it('nennt den Einheitstyp als Herkunft an der Vorlage (LLH-1042)', () => {
    expect(typVorgabe('1/2/19//22')).toBe('Vorgabe des Einheitstyps: 1/2/19//22');
  });
});
