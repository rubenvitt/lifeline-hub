import type { EinsatzAnzeige } from '../api/types';

/**
 * Reine Ableitungen der Einsatzkachel (Einsatzliste/Startseite).
 *
 * Eigener Basename neben `EinsaetzePage.tsx`: ein gleichnamiges `.ts` beschattete die Komponente.
 */

/**
 * Die Einsatznummer der Kachel: die interne Nummer, sonst die Leitstellennummer, sonst keine.
 * Dieselbe Regel wie `einsatzKennung` in `einsatz/EinsatzLayout.tsx` — eigene Funktion, weil der
 * Import das ganze Layout in die Startseite zöge. Die Datenbank-`id` ist keine Einsatznummer.
 */
export function kachelKennung(
  einsatz: Pick<EinsatzAnzeige, 'einsatznummer_intern' | 'leitstellen_nr'>,
): string | null {
  const intern = einsatz.einsatznummer_intern?.trim();
  if (intern) return intern;
  const leitstelle = einsatz.leitstellen_nr?.trim();
  return leitstelle ? leitstelle : null;
}

/** Mono-Meta des Seitenkopfs: „3 aktiv · 12 abgeschlossen". */
export function einsaetzeMeta(aktiv: number, abgeschlossen: number): string {
  return `${aktiv} aktiv · ${abgeschlossen} abgeschlossen`;
}
