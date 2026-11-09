/** Wortverbindungszeichen: unsichtbar, ohne Breite, kein Umbruch. */
const WJ = '\u2060';

/**
 * Entschärft, was `components/Markdown.tsx` (remark-gfm) als Auszeichnung läse: Backslash,
 * Backtick, Stern, Unterstrich, eckige Klammern, die Tilde (GFM streicht schon `~x~` durch) und
 * `<` (spitzer Autolink `<https://x>`, `<a@b.de>`).
 *
 * GFM-Autolink-Literale (`www.`, `http(s)://`, E-Mail, LFH-868) hilft kein Backslash: remark-gfm
 * sucht sie erst NACH dem Auflösen der Escapes im fertigen Textknoten (`www\.x.de` wird trotzdem
 * ein Link). Deshalb steht dort ein {@link WJ} zwischen `www` und `.`, zwischen `:` und `//` und
 * vor dem `@`: die Muster greifen nicht mehr, sichtbar bleibt derselbe Text.
 * Genutzt von Funkplan, Lagebericht-Übernahmen, Vorbereitung der Lagebesprechung (`lagebesprechung/vorbereitung.ts`) und Organigramm
 * (`pages/einsatzabschnitte/fuehrungsorganisation.ts`).
 */
export function md(text: string): string {
  return text
    .replace(/[\\`*_[\]~<]/g, (z) => `\\${z}`)
    .replace(/(www)(?=\.)/gi, `$1${WJ}`)
    .replace(/(https?:)(?=\/\/)/gi, `$1${WJ}`)
    .replace(/(?<=[-.\w+])@/g, `${WJ}@`);
}
