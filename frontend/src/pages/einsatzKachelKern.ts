import type { EinsatzAnzeige } from '../api/types';
import { einsatzKennung } from '../einsatz/einsatzKennung';

/**
 * Reine Ableitungen der Einsatzkachel (Einsatzliste/Startseite).
 *
 * Eigener Basename neben `EinsaetzePage.tsx`: ein gleichnamiges `.ts` beschattete die Komponente.
 */

/** Die Einsatznummer der Kachel: dieselbe Regel wie im Kopf (`einsatz/einsatzKennung.ts`). */
export function kachelKennung(
  einsatz: Pick<EinsatzAnzeige, 'einsatznummer_intern' | 'leitstellen_nr'>,
): string | null {
  return einsatzKennung(einsatz);
}

/** Mono-Meta des Seitenkopfs: „3 aktiv · 12 abgeschlossen". */
export function einsaetzeMeta(aktiv: number, abgeschlossen: number): string {
  return `${aktiv} aktiv · ${abgeschlossen} abgeschlossen`;
}
