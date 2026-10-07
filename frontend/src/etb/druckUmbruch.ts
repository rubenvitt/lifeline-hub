/**
 * Ab wann eine ETB-Zeile im Druck umbrechen darf (LFH-1009).
 *
 * Eine Zeile bricht auf Papier nicht über den Seitenrand (`tr`/`p` mit `break-inside: avoid` in
 * `druck/druck.css`). Bei einem überlangen Eintrag — der volle Text eines freigegebenen
 * Lageberichts — schob das die Zeile auf Seite 2, Seite 1 trug nur den Druckkopf, und weil jeder
 * Absatz zusammenbleiben wollte, standen die Folgeseiten nur zu 50–85 % voll.
 *
 * Die Druckhöhe kennt erst der Seitensatz, nicht die Bildschirmansicht (andere Breite). Deshalb
 * schätzt diese Funktion die Zeilenzahl aus dem Text, gegen die Inhaltsspalte auf A4 hoch
 * (gemessen an den Belegen der Druckprüfung: rund 36 Zeichen je Zeile, rund 70 Zeilen je Seite).
 * Ab einer halben Seite bricht die Zeile frei: was höher ist, ließe beim Verschieben mehr als eine
 * halbe Seite leer.
 */

/** Zeichen je Druckzeile in der Inhaltsspalte (eher knapp, damit die Schätzung nicht zu kurz rät). */
const ZEICHEN_JE_ZEILE = 36;

/** Ab dieser geschätzten Zeilenzahl gilt ein Eintrag als überlang: etwa eine halbe A4-Seite. */
export const UEBERLANG_AB_ZEILEN = 35;

/** Geschätzte Druckzeilen eines Markdown-Inhalts; eine Leerzeile zählt als Absatzabstand. */
export function geschaetzteDruckzeilen(inhalt: string): number {
  return inhalt
    .split('\n')
    .reduce((summe, zeile) => summe + Math.max(1, Math.ceil(zeile.length / ZEICHEN_JE_ZEILE)), 0);
}

export function istUeberlang(inhalt: string): boolean {
  return geschaetzteDruckzeilen(inhalt) >= UEBERLANG_AB_ZEILEN;
}
