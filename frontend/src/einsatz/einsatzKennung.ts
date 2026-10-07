import type { EinsatzAnzeige } from '../api/types';

/**
 * Die Einsatznummer für Kopf, Wechsler und Kachel: die interne, sonst die Leitstellennummer,
 * sonst KEINE — die Datenbank-`id` ist keine Einsatznummer. Eigene Datei, damit Wechsler und
 * Startseite nicht das ganze Layout importieren.
 */
export function einsatzKennung(
  einsatz: Pick<EinsatzAnzeige, 'einsatznummer_intern' | 'leitstellen_nr'> | undefined,
): string | null {
  const intern = einsatz?.einsatznummer_intern?.trim();
  if (intern) return intern;
  const leitstelle = einsatz?.leitstellen_nr?.trim();
  return leitstelle ? leitstelle : null;
}
