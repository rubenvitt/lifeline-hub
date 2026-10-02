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

/** Ob der Anhang ein Bild ist — nur dort unterscheiden sich Original und bereinigte Fassung. */
export function istBildMime(mime: string | null | undefined): boolean {
  return mime?.startsWith('image/') ?? false;
}
