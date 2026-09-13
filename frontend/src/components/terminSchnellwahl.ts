import type { Dayjs } from 'dayjs';

/**
 * Schnellwahl relativer Termine — geteilt von der ETB-Wiedervorlage (LFH-342 · C7) und dem
 * Abschluss der Lagebesprechung (LFH-543). Gehoben, nicht kopiert: zwei Tabellen mit denselben
 * Beschriftungen liefen auseinander, ohne dass ein Test es bemerkt.
 *
 * Die Beschriftungen sind Bestand und hängen an Tests („+1 h", nicht „+60 min").
 * `components/`, nicht `etb/` oder `stab/`: beide Module konsumieren sie, keines besitzt sie.
 */
export interface SchnellwahlEintrag {
  readonly label: string;
  readonly minuten: number;
}

export const SCHNELLWAHL_TERMIN: readonly SchnellwahlEintrag[] = [
  { label: '+15 min', minuten: 15 },
  { label: '+30 min', minuten: 30 },
  { label: '+1 h', minuten: 60 },
  { label: '+2 h', minuten: 120 },
];

/**
 * Die Einträge zu den genannten Minuten, in Tabellenreihenfolge.
 *
 * Eine unbekannte Minutenzahl ist ein Programmierfehler und wirft: still weggelassen fehlte ein
 * Knopf, ohne dass es jemand bemerkt.
 */
export function schnellwahlAuswahl(minuten: readonly number[]): SchnellwahlEintrag[] {
  const unbekannt = minuten.filter((m) => !SCHNELLWAHL_TERMIN.some((e) => e.minuten === m));
  if (unbekannt.length > 0) {
    throw new Error(`Keine Schnellwahl für ${unbekannt.join(', ')} min`);
  }
  return SCHNELLWAHL_TERMIN.filter((e) => minuten.includes(e.minuten));
}

/**
 * Termin = Bezug + Minuten. Der Bezug ist Sache des Aufrufers: die Wiedervorlage rechnet ab
 * jetzt, der Abschluss der Lagebesprechung ab dem Zeitpunkt der Besprechung — sonst lehnte das
 * Backend `naechste_at ≤ abgehalten_at` mit 422 ab (`src/routes/stab.rs:240-246`).
 */
export function schnellwahlTermin(bezug: Dayjs, minuten: number): Dayjs {
  return bezug.add(minuten, 'minute');
}
