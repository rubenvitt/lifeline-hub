import { describe, expect, it } from 'vitest';
import { personenDruckAuswahl } from './druckAuswahl';

// LFH-727: die Kopfzeile „Auswahl“ der Personen-Druckansicht — die Wörter der Liste, nie ein Schlüssel.
describe('personenDruckAuswahl', () => {
  it('nennt ohne Filter die vollständige Liste', () => {
    expect(personenDruckAuswahl({ filter: 'alle', nurLuecken: false })).toBe('alle Personen');
  });

  it('nennt den Status mit dem Wort der Liste', () => {
    expect(personenDruckAuswahl({ filter: 'vermisst', nurLuecken: false })).toBe(
      'Status: Vermisst',
    );
    // „erfasst“ heißt in Filter und Tabelle gleich (LFH-963).
    expect(personenDruckAuswahl({ filter: 'erfasst', nurLuecken: false })).toBe('Status: Erfasst');
  });

  it('nennt „nur offene Felder“, allein und mit Status', () => {
    expect(personenDruckAuswahl({ filter: 'alle', nurLuecken: true })).toBe('nur offene Felder');
    expect(personenDruckAuswahl({ filter: 'betroffen', nurLuecken: true })).toBe(
      'Status: Betroffen · nur offene Felder',
    );
  });
});
