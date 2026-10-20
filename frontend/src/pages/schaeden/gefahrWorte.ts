import type { Gefahrentyp, Schadensgrad } from '../../api/types';
import { GEFAHRENTYPEN, GEFAHRENTYPEN_ALPHABETISCH } from '../gefahren/gefahrenSchema';

// Wörter für Gefahr und Schadensgrad eines Schadens (LLH-1115), ohne JSX: die Lagekarte
// (Inspektor) liest sie, ohne die Seitenhelfer der Schadensliste mitzuladen.

/**
 * Gefahrenart eines Schadens (LLH-1115): dieselben Wörter wie im Gefahrengebiet
 * (`GEFAHRENTYPEN`), damit ein Schaden und ein Gefahrengebiet mit derselben Gefahr gleich heißen.
 */
export const GEFAHR_LABEL = Object.fromEntries(
  GEFAHRENTYPEN.map((g) => [g.wert, g.label]),
) as Record<Gefahrentyp, string>;

/** Die Gefahrenarten in der Reihenfolge der Gefahrenmatrix: alphabetisch (LLH-1102). */
export const GEFAHRENARTEN: readonly Gefahrentyp[] = GEFAHRENTYPEN_ALPHABETISCH.map((g) => g.wert);

/** Schadensgrad nach DV 102, 5.8.4 (LLH-1115); dieselben Wörter wie `Schadensgrad::etb_label`. */
export const SCHADENSGRAD_LABEL: Record<Schadensgrad, string> = {
  angeschlagen: 'angeschlagen',
  teilzerstoert: 'teilzerstört',
  zerstoert: 'total zerstört',
};

/**
 * Gefahr und Schadensgrad als eine Zeile für Liste und Druck: „Elektrizität · total zerstört“,
 * nur der Schadensgrad, oder „—“. Ein unbekannter gespeicherter Wert fällt weg.
 */
export function gefahrText(s: {
  gefahrenart?: Gefahrentyp | null;
  schadensgrad?: Schadensgrad | null;
}): string {
  const teile = [
    s.gefahrenart ? GEFAHR_LABEL[s.gefahrenart] : undefined,
    s.schadensgrad ? SCHADENSGRAD_LABEL[s.schadensgrad] : undefined,
  ].filter(Boolean);
  return teile.length > 0 ? teile.join(' · ') : '—';
}
