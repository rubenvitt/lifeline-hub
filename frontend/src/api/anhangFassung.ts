/**
 * Fassungen eines Anhang-Downloads (LFH-747, Spec `anhang-metadaten`). Jede Download-Route
 * liefert ohne Angabe die bereinigte Fassung (ohne Standort, Gerät, Aufnahmezeit); das Original
 * gibt es über `?fassung=original` nur für Einsatzleitung und System-Admin, und der Server
 * vermerkt jeden Abruf im ETB. Wer darf, entscheidet `darfOriginalLaden` in
 * `einsatz/schreibrecht.ts`.
 */

/** Download-Adresse des Originals zu einer Download-Adresse der bereinigten Fassung. */
export function originalPfad(href: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}fassung=original`;
}

/**
 * Dateiname des Originals: `.original` vor der Endung (`dach.jpg` → `dach.original.jpg`). Sonst
 * lägen Original und bereinigte Fassung als `dach.jpg` und `dach (1).jpg` nebeneinander, und
 * niemand sähe mehr, welche Datei den Standort trägt. Der Server setzt denselben Namen in
 * `Content-Disposition` (`anhang::original_dateiname`).
 */
export function originalDateiname(dateiname: string): string {
  const punkt = dateiname.lastIndexOf('.');
  return punkt > 0
    ? `${dateiname.slice(0, punkt)}.original${dateiname.slice(punkt)}`
    : `${dateiname}.original`;
}

/** Zugänglicher Name des Original-Verweises; `kennung` ist die Zeilenkennung des Aufrufers. */
export function originalZugaenglicherName(kennung: string): string {
  return `${kennung}: Original mit Standort- und Gerätedaten herunterladen`;
}

/** Ob der Anhang ein Bild ist — nur dort unterscheiden sich Original und bereinigte Fassung. */
export function istBildMime(mime: string | null | undefined): boolean {
  return mime?.startsWith('image/') ?? false;
}
