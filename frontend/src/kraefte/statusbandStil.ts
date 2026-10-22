import type { Verteilungszeile } from '../components/instrument';
import { anteil } from '../components/instrument/Aufgliederung';
import { statusFlaeche } from '../components/instrument/statusFlaeche';
import type { BandZelle } from './meldebildRaster';

/**
 * Reine Darstellungsregeln des Statusbands, getrennt von `Statusband.tsx`, damit ohne Rendern
 * prüfbar.
 */

/**
 * Die Zellen einer Gruppe als Zeilen eines `VerteilungsPaneel` (LLH-1140, vorher Segmente einer
 * Aufgliederung, LLH-1025 D9): Wort ist der FMS-Code, das Statuswort steht gedämpft daneben;
 * ohne Code ist das Wort selbst die Kategorie. Der Anteil bezieht sich auf die Summe der Gruppe.
 * Die Farbe ist die Kante des Tons — dieselbe Zuordnung wie der Statuspunkt, keine zweite
 * Statuskarte.
 */
export function bandVerteilung(
  zellen: readonly BandZelle[],
  rollen: Parameters<typeof statusFlaeche>[0],
): Verteilungszeile[] {
  const summe = zellen.reduce((s, z) => s + z.wert, 0);
  return zellen.map((z) => ({
    schluessel: z.schluessel,
    wort: z.code ?? z.wort,
    beschreibung: z.code != null ? z.wort : undefined,
    wert: z.wert,
    anteil: anteil(z.wert, summe),
    balkenFarbe: statusFlaeche(rollen, z.ton).kante,
  }));
}
