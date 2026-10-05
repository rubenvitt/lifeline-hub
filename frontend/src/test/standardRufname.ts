import { vi } from 'vitest';
import type { StandardRufname } from '../etb/standardRufname';
import type { StandardRufnameZugriff } from '../etb/useStandardRufname';

/**
 * Ein fester Standard-Rufname (LFH-894) für Tests der ETB-Erfassung. Ohne ihn blockiert die
 * Von/An-Pflicht jedes Absenden; wer die Pflicht oder die Abfrage prüft, übergibt `null`.
 */
export function rufnameZugriff(
  standard: StandardRufname | null = { von: 'ELW 1', an: 'ELW 1' },
): StandardRufnameZugriff {
  return {
    standard,
    geladen: true,
    setze: vi.fn<(wert: string) => Promise<void>>().mockResolvedValue(undefined),
  };
}
