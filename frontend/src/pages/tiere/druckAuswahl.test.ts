import { describe, expect, it } from 'vitest';
import { tiereDruckAuswahl } from './druckAuswahl';

// LFH-727: Kopfzeile „Auswahl“ der Tiere-Druckansicht mit den Wörtern der Liste.
describe('tiereDruckAuswahl', () => {
  it('nennt ohne Filter die vollständige Liste', () => {
    expect(tiereDruckAuswahl({ sicht: 'alle' })).toBe('alle Tiere');
  });

  it('nennt Sicht und Spezies mit den Wörtern der Liste', () => {
    expect(tiereDruckAuswahl({ sicht: 'aktiv' })).toBe('Sicht: Aktiv');
    expect(tiereDruckAuswahl({ sicht: 'vermisst', spezies: 'hund' })).toBe(
      'Sicht: Vermisst · Spezies: Hund',
    );
    expect(tiereDruckAuswahl({ sicht: 'alle', spezies: 'nutzgefluegel' })).toBe(
      'Spezies: Nutzgeflügel',
    );
  });
});
