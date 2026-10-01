import { describe, expect, it } from 'vitest';
import { schaedenDruckAuswahl } from './druckAuswahl';

// LFH-727: Kopfzeile „Auswahl“ der Schäden-Druckansicht mit den Wörtern der Liste.
describe('schaedenDruckAuswahl', () => {
  it('nennt ohne Filter die vollständige Liste', () => {
    expect(schaedenDruckAuswahl({ sicht: 'alle' })).toBe('alle Schäden');
  });

  it('nennt die Sicht mit dem Wort der Liste', () => {
    expect(schaedenDruckAuswahl({ sicht: 'offen' })).toBe('Sicht: Offen');
    expect(schaedenDruckAuswahl({ sicht: 'uebergeben' })).toBe('Sicht: Übergeben');
  });
});
