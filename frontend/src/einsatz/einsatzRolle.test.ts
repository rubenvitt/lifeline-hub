import { describe, expect, it } from 'vitest';
import type { EinsatzRolle } from '../api/types';
import { EINSATZ_ROLLE_LABELS, EINSATZ_ROLLE_OPTIONEN } from './einsatzRolle';

describe('EINSATZ_ROLLE_LABELS', () => {
  it('gibt jeder Einsatzrolle aus dem Codegen ein Wort, nie den Rohwert', () => {
    // Die Liste steht hier ausdrücklich: `satisfies` bricht den Typcheck, wenn der Codegen eine
    // Rolle ergänzt, die hier fehlt — dann fehlt sie auch in `EINSATZ_ROLLE_LABELS`.
    const alle = [
      'einsatzleitung',
      'fuehrungspersonal',
      'beobachter',
    ] as const satisfies readonly EinsatzRolle[];
    type Fehlend = Exclude<EinsatzRolle, (typeof alle)[number]>;
    const vollstaendig: [Fehlend] extends [never] ? true : false = true;
    expect(vollstaendig).toBe(true);
    for (const rolle of alle) {
      expect(EINSATZ_ROLLE_LABELS[rolle]).toBeTruthy();
      expect(EINSATZ_ROLLE_LABELS[rolle]).not.toBe(rolle);
    }
    expect(EINSATZ_ROLLE_LABELS.fuehrungspersonal).toBe('Führungspersonal');
  });

  it('leitet die Optionen aus der Tabelle ab', () => {
    expect(EINSATZ_ROLLE_OPTIONEN).toEqual([
      { value: 'einsatzleitung', label: 'Einsatzleitung' },
      { value: 'fuehrungspersonal', label: 'Führungspersonal' },
      { value: 'beobachter', label: 'Beobachter' },
    ]);
  });
});
