import type { AbBreitePunkt } from '../components/useViewport';

/**
 * Reine Darstellungsregeln des Statusbands, getrennt von `Statusband.tsx`, damit ohne Rendern
 * prüfbar. Die Farbregeln liegen im Baustein `Kennzahl` (`zahlFarbe`, `punktFarbe`).
 */

/** Spaltenzahl des Bands: 6 ab `xl`, 3 ab `md`, 2 darunter. */
export function bandSpalten(abBreite: (punkt: AbBreitePunkt) => boolean): number {
  if (abBreite('xl')) return 6;
  if (abBreite('md')) return 3;
  return 2;
}
