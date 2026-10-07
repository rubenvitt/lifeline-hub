import { describe, expect, it } from 'vitest';
import { mitVorgabe, orgVorgabe } from './vorgabeText';

describe('vorgabeText — ein Wortlaut für voreingestellte Werte (LFH-944)', () => {
  it('setzt „(Vorgabe)“ hinter den System-Wert im Platzhalter', () => {
    expect(mitVorgabe('24 Stunden')).toBe('24 Stunden (Vorgabe)');
  });

  it('nennt die Organisation als Herkunft im Einsatz', () => {
    expect(orgVorgabe('24 Stunden')).toBe('Vorgabe der Organisation: 24 Stunden');
  });
});
