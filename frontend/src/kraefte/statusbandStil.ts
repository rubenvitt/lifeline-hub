import type { Segment } from '../components/instrument';
import { statusFlaeche } from '../components/instrument/statusFlaeche';
import type { BandZelle } from './meldebildRaster';

/**
 * Reine Darstellungsregeln des Statusbands, getrennt von `Statusband.tsx`, damit ohne Rendern
 * prüfbar. Die Farbregeln der Zahl liegen im Baustein `Kennzahl` (`zahlFarbe`, `punktFarbe`).
 */

/**
 * Die Zellen einer Gruppe als Segmente der Aufgliederung (LLH-1025, D9): Etikett ist der
 * FMS-Code, ohne Code das Wort; die Farbe ist die Kante des Tons — dieselbe Zuordnung wie der
 * Statuspunkt, keine zweite Statuskarte.
 */
export function bandSegmente(
  zellen: readonly BandZelle[],
  rollen: Parameters<typeof statusFlaeche>[0],
): Segment[] {
  return zellen.map((z) => ({
    label: z.code ?? z.wort,
    wert: z.wert,
    farbe: statusFlaeche(rollen, z.ton).kante,
  }));
}
