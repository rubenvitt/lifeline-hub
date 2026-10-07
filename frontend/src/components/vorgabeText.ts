/**
 * EIN Wortlaut für voreingestellte Werte (LFH-944, Spec `bedien-begriffe`): ein Wert, der gilt,
 * wenn niemand etwas wählt oder einträgt, heißt im sichtbaren Text „Vorgabe“ — nie „Default“,
 * „Fallback“ oder „Standard“. Der Guard `vorgabe.guard.test.ts` hält die Altwörter draußen.
 *
 * Bausteine statt freier Sätze, nach dem Muster von `stammdaten/rechteText.ts`: eine
 * abweichende Fassung fiele niemandem auf, weil jede Seite für sich plausibel aussieht. Die Ebene
 * bleibt lesbar: System (fest im Code), Organisation (Verwaltung), Einsatz.
 */

/** Platzhalter eines leeren Feldes: der System-Wert, der dann gilt. */
export function mitVorgabe(wert: string): string {
  return `${wert} (Vorgabe)`;
}

/** Hinweis unter einem leeren Einsatz-Feld, für das die Organisation einen Wert gesetzt hat. */
export function orgVorgabe(wert: string): string {
  return `Vorgabe der Organisation: ${wert}`;
}
