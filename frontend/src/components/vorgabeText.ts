/**
 * EIN Wortlaut für voreingestellte Werte (LFH-944, Spec `bedien-begriffe`): ein Wert, der gilt,
 * wenn niemand etwas wählt oder einträgt, heißt im sichtbaren Text „Vorgabe“ — nie „Default“,
 * „Fallback“ oder „Standard“. Der Guard `vorgabe.guard.test.ts` hält die Altwörter draußen.
 *
 * Bausteine statt freier Sätze, nach dem Muster von `stammdaten/rechteText.ts`: eine
 * abweichende Fassung fiele niemandem auf, weil jede Seite für sich plausibel aussieht. Die Ebene
 * bleibt lesbar: System (fest im Code), Organisation (Verwaltung), Einsatz, Abschnitt.
 */

/** Platzhalter eines leeren Feldes: der System-Wert, der dann gilt. */
export function mitVorgabe(wert: string): string {
  return `${wert} (Vorgabe)`;
}

/** Hinweis unter einem leeren Einsatz-Feld, für das die Organisation einen Wert gesetzt hat. */
export function orgVorgabe(wert: string): string {
  return `Vorgabe der Organisation: ${wert}`;
}

/** Platzhalter eines leeren Feldes, dessen Wert die Vorgabe des Einsatzabschnitts liefert. */
export function abschnittVorgabe(wert: string): string {
  return `${wert} (Vorgabe Abschnitt)`;
}

/**
 * Platzhalter eines leeren Feldes, dessen Wert die Vorgabe des Einsatzes liefert (LLH-1122,
 * Schichtmodell des Einsatzes); neben „Vorgabe Abschnitt“ bleibt die Rangfolge lesbar.
 */
export function einsatzVorgabe(wert: string): string {
  return `${wert} (Vorgabe Einsatz)`;
}

/**
 * Zeile der Einsatzanlage, deren Wert die gewählte Einsatz-Vorlage liefert (LLH-1313,
 * Schichtmodell der Vorlage statt der Vorgabe der Organisation).
 */
export function vorlageVorgabe(wert: string): string {
  return `${wert} (Vorgabe Vorlage)`;
}

/** Hinweis unter einem leeren Feld, für das der Einheitstyp einen Wert setzt (LLH-1042). */
export function typVorgabe(wert: string): string {
  return `Vorgabe des Einheitstyps: ${wert}`;
}
