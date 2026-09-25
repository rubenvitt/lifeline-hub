import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  istAdmin,
  istEinsatzLeitung,
  type BenutzerSchreibkontext,
  type EinsatzSchreibkontext,
} from '../einsatz/schreibrecht';

dayjs.extend(utc);

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

/**
 * Die Frist, die aus einer Picker-Eingabe hinausgeht. Der Picker zeigt und parst Minuten; die
 * gespeicherte Frist trägt die Sekunden des Abschlusses (`abgeschlossen_at` + Dauer). Wer die
 * ANGEZEIGTE Minute erneut eingibt, meint „unverändert“ — dann geht der gespeicherte Wert
 * sekundengenau zurück: keine Verkürzung um den Sekundenrest, keine Rückfrage, und der Server
 * antwortet ohne Schreibvorgang und ohne ETB-Eintrag.
 */
export function fristAusEingabe(eingabe: string, basis: string | null | undefined): string {
  if (basis != null && eingabe.slice(0, 16) === basis.slice(0, 16)) return basis;
  return eingabe;
}

/** Ob ein Wire-Zeitpunkt (UTC, `YYYY-MM-DD HH:mm:ss`) zu `jetzt` schon erreicht ist — dieselbe
 *  Grenze wie die Lesesperre (`jetzt >= retention_bis`). */
export function liegtInDerVergangenheit(frist: string, jetzt: dayjs.Dayjs): boolean {
  const f = dayjs.utc(frist);
  return f.isValid() && !jetzt.isBefore(f);
}
