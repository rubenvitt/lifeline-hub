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

/**
 * Wortlaut des Sammelbanners der Einsatzübersicht (LLH-1204): „1 neuer Einsatz“ statt des
 * allgemeinen „Eintrags“ der `Datensicht`. Ohne Wartendes `null`.
 */
export function einsaetzeBannerText(neu: number): string | null {
  if (neu <= 0) return null;
  return neu === 1 ? '1 neuer Einsatz' : `${neu} neue Einsätze`;
}
