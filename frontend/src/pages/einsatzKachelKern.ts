import type { EinsatzAnzeige } from '../api/types';

/**
 * Reine Ableitungen der Einsatzkachel (Einsatzliste/Startseite, Neuentwurf).
 *
 * Eigene Datei mit eigenem Basename neben `EinsaetzePage.tsx` (CLAUDE.md,
 * `direkteinstiegKern`: ein gleichnamiges `.ts` beschattet die Komponente).
 */

/**
 * Die Einsatznummer der Kachel: die interne Nummer, sonst die Leitstellennummer, sonst
 * KEINE. Dieselbe Regel wie `einsatzKennung` im Einsatz-Kopf (`einsatz/EinsatzLayout.tsx`)
 * — hier als eigene Funktion, weil der Import das ganze Layout (Rail, Router-Teile) in die
 * Startseite zöge. Die Datenbank-`id` ist ausdrücklich KEINE Einsatznummer
 * (Neuentwurf, Entscheidung 4: nichts erfinden).
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
