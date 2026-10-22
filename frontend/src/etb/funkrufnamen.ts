import { useMemo } from 'react';
import { useFunkrufnamenEinsatz } from '../stammdaten/vorschlagsquellen';

/**
 * Funkrufnamen des aktuellen Einsatzes als Text: disponierte Fahrzeuge (Funkrufname, OPTA in
 * Klammern) + Einheiten (Name), alphabetisch. Für das `@`-Menü der Schnellerfassung; die Von/An-
 * Felder nehmen die Quellen des Vorschlagsfelds (`stammdaten/vorschlagsquellen.ts`, LLH-1144),
 * aus derselben Abbildung.
 */
export function useFunkrufnamen(einsatzId: number): string[] {
  const vorschlaege = useFunkrufnamenEinsatz(einsatzId);
  return useMemo(() => vorschlaege.map((v) => v.wert), [vorschlaege]);
}
