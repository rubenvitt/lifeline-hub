import {
  istAdmin,
  istEinsatzLeitung,
  type BenutzerSchreibkontext,
  type EinsatzSchreibkontext,
} from '../einsatz/schreibrecht';

/**
 * Reine Regeln der Aufbewahrungsfrist am Einsatz (LFH-23, design.md D8).
 *
 * Die Frist ist NICHT Teil der eingefrorenen Einstellungen: Einsatzleitung und System-Admin
 * setzen sie auch nach dem Abschluss (`PUT …/aufbewahrungsfrist`) — deshalb hängt
 * {@link darfFristSetzen} bewusst nicht am Status, anders als `darfEinsatzLeiten`.
 */

/**
 * Spiegel von `einsatz::berechtigung::ist_fristverkuerzung`: Aufheben ist nie eine Verkürzung,
 * erstmaliges Setzen an einem Einsatz ohne Frist schon (von „unbegrenzt" auf endlich), sonst
 * zählt ein früherer Zeitpunkt. Vergleich lexikografisch — korrekt für das feste Wire-Format
 * `YYYY-MM-DD HH:mm:ss` (UTC), das beide Seiten tragen.
 */
export function istFristverkuerzung(
  alt: string | null | undefined,
  neu: string | null | undefined,
): boolean {
  if (neu == null) return false;
  if (alt == null) return true;
  return neu < alt;
}

/** Einsatzleitung (Mitgliedschaft) oder System-Admin — wie der Server, unabhängig vom Status. */
export function darfFristSetzen(
  einsatz: EinsatzSchreibkontext,
  benutzer: BenutzerSchreibkontext,
): boolean {
  return istEinsatzLeitung(einsatz) || istAdmin(benutzer);
}
