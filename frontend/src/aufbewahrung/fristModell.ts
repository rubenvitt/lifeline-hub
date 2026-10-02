import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';
import { istAdmin, istEinsatzLeitung } from '../einsatz/schreibrecht';

dayjs.extend(utc);

/**
 * Reine Regeln der Aufbewahrungsfrist am Einsatz. Die Frist ist nicht Teil der eingefrorenen
 * Einstellungen, deshalb hängt {@link darfFristSetzen} nicht am Status.
 */

/**
 * Spiegel von `einsatz::berechtigung::ist_fristverkuerzung`: Aufheben ist nie eine Verkürzung,
 * erstmaliges Setzen schon, sonst zählt ein früherer Zeitpunkt. Lexikografischer Vergleich,
 * korrekt für das feste Wire-Format `YYYY-MM-DD HH:mm:ss` (UTC).
 */
export function istFristverkuerzung(
  alt: string | null | undefined,
  neu: string | null | undefined,
): boolean {
  if (neu == null) return false;
  if (alt == null) return true;
  return neu < alt;
}

/** Einsatz-Kontext des Frist-Rechts: Rolle und Org des Einsatzes. */
export type FristEinsatzKontext =
  Pick<EinsatzAnzeige, 'status' | 'meine_rolle' | 'org_id'> | null | undefined;

/** Benutzer-Kontext des Frist-Rechts: System-Rolle und eigene Org. */
export type FristBenutzerKontext =
  Pick<BenutzerAnzeige, 'system_rolle' | 'org_id'> | null | undefined;

/**
 * Einsatzleitung (Mitgliedschaft) oder System-Admin der Einsatz-Org — wie der Server
 * (`aufbewahrungsfrist_setzen`, LFH-753), unabhängig vom Status. Der Admin einer fremden Org
 * bekäme dort 403, die Aktion steht für ihn deshalb gesperrt.
 */
export function darfFristSetzen(
  einsatz: FristEinsatzKontext,
  benutzer: FristBenutzerKontext,
): boolean {
  if (istEinsatzLeitung(einsatz)) return true;
  return istAdmin(benutzer) && einsatz != null && benutzer?.org_id === einsatz.org_id;
}

/**
 * Die Frist, die aus einer Picker-Eingabe hinausgeht. Der Picker kennt nur Minuten, die
 * gespeicherte Frist trägt Sekunden. Wer die ANGEZEIGTE Minute erneut eingibt, meint
 * „unverändert“ — dann geht der gespeicherte Wert sekundengenau zurück (keine Verkürzung,
 * keine Rückfrage, kein Schreibvorgang am Server).
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
