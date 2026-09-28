import type { Staerke } from '../api/types';

/**
 * Summe der kumulierten Ist-Stärke einer Einheitenmenge, oder `null` bei leerer Menge:
 * „keine Einheit zugeordnet" ist eine andere Aussage als „null Personen".
 */
export function summiereStaerke(
  einheiten: ReadonlyArray<{ ist_kumuliert: Staerke }>,
): Staerke | null {
  if (einheiten.length === 0) return null;
  return einheiten.reduce<Staerke>(
    (acc, e) => ({
      fuehrer: acc.fuehrer + (e.ist_kumuliert?.fuehrer ?? 0),
      unterfuehrer: acc.unterfuehrer + (e.ist_kumuliert?.unterfuehrer ?? 0),
      mannschaft: acc.mannschaft + (e.ist_kumuliert?.mannschaft ?? 0),
    }),
    { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  );
}
