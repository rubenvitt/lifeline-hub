import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { alsBackendZeit, alsOrtszeit } from './filterZeit';

dayjs.extend(utc);

/**
 * Die Zeitachse der ETB-Filterleiste, beide Richtungen.
 *
 * Warum das einen eigenen Test bekommt und nicht bloß mitläuft: der Fehlermodus der
 * Rückrichtung ist eine STILLE Verschiebung um den Zonenversatz. Kein roter Test, kein
 * Fehlerbild — nur ein falscher Zeitraum in einer beweissichernden Unterlage. Der
 * Dateikopf von `EtbFilterleiste.tsx` hat diesen Test als Vorbedingung benannt, bevor
 * jemand die Leiste hydriert (LFH-331 · B3).
 */
describe('filterZeit', () => {
  it('Round-Trip erhält den Zeitpunkt — auch beidseits der Sommerzeit-Grenzen', () => {
    // Beide mitteleuropäischen Umstellungen 2026, je eine Stunde davor und danach.
    for (const wire of [
      '2026-03-29T00:30:00Z',
      '2026-03-29T01:30:00Z',
      '2026-10-25T00:30:00Z',
      '2026-10-25T01:30:00Z',
    ]) {
      const s = dayjs(wire).utc().format('YYYY-MM-DD HH:mm:ss');
      const zurueck = alsOrtszeit(s);
      expect(zurueck, wire).toBeDefined();
      expect(alsBackendZeit(zurueck!), wire).toBe(s);
      /*
       * Die zweite Hälfte, und sie ist die tragende: ein Round-Trip, der BEIDE
       * Richtungen um denselben Betrag verschiebt, wäre mit der Zeile darüber allein
       * grün. Erst der Vergleich gegen den absoluten Zeitpunkt schließt das aus.
       */
      expect(zurueck!.valueOf(), wire).toBe(dayjs(wire).valueOf());
    }
  });

  it('liest einen Wire-String als UTC, nicht als Ortszeit', () => {
    // Der Wire-String trägt KEINE Zonenkennung. `dayjs(s)` läse ihn als Ortszeit und
    // verschöbe den Zeitpunkt um den Versatz — in Berlin im Sommer um zwei Stunden.
    expect(alsOrtszeit('2026-08-21 06:00:00')!.valueOf()).toBe(
      dayjs('2026-08-21T06:00:00Z').valueOf(),
    );
  });

  it('leere und unbrauchbare Eingaben ergeben undefined, nicht Invalid Date', () => {
    expect(alsOrtszeit(undefined)).toBeUndefined();
    expect(alsOrtszeit('')).toBeUndefined();
    expect(alsOrtszeit('kein-datum')).toBeUndefined();
  });
});
