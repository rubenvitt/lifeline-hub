import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gemerkteStellenRaeumen, liesGemerkteStelle, merkeStelle } from './stellenGedaechtnis';

/**
 * Die gemerkte Stellenwahl der Ausgabeansicht (LLH-1040, design.md D13 Punkt 7): nur eine Kennung
 * je Einsatz, über `lib/sichererSpeicher`, bei jedem Ausgang geräumt.
 */

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('stellenGedaechtnis', () => {
  it('merkt die Wahl je Einsatz und liest sie zurück', () => {
    merkeStelle(7, 21);
    merkeStelle(8, 22);
    expect(liesGemerkteStelle(7)).toBe(21);
    expect(liesGemerkteStelle(8)).toBe(22);
    expect(liesGemerkteStelle(9)).toBeNull();
  });

  it('„ohne Stelle“ entfernt den Eintrag', () => {
    merkeStelle(7, 21);
    merkeStelle(7, null);
    expect(liesGemerkteStelle(7)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('ein fremder Wert gilt als nichts gemerkt', () => {
    localStorage.setItem('lfh:verpflegung:stelle:7', 'Feldküche');
    expect(liesGemerkteStelle(7)).toBeNull();
  });

  it('ein gesperrter Speicher wirft nicht: lesen ergibt nichts, schreiben geht ins Leere', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    expect(() => merkeStelle(7, 21)).not.toThrow();
    expect(liesGemerkteStelle(7)).toBeNull();
  });

  it('Räumen nimmt alle gemerkten Stellen, fremde Schlüssel bleiben', () => {
    merkeStelle(7, 21);
    merkeStelle(8, 22);
    localStorage.setItem('lifeline-hub.theme', 'dunkel');
    gemerkteStellenRaeumen();
    expect(liesGemerkteStelle(7)).toBeNull();
    expect(liesGemerkteStelle(8)).toBeNull();
    expect(localStorage.getItem('lifeline-hub.theme')).toBe('dunkel');
  });
});
