/**
 * Fundstellen der ETB-Volltextsuche in einem Text (LFH-1056).
 *
 * Die Markierung zeigt, WARUM der Server einen Eintrag geliefert hat; sie markiert deshalb genau
 * das, was die Suche trifft, nicht eine eigene Lesart des Begriffs:
 *
 * - **Phrasen wie `fts_query`** (`src/etb/repo.rs`): jedes Wort der Eingabe (Trennung an
 *   Leerraum) ist eine Phrase, Wörter ohne Buchstaben oder Ziffern fallen weg. Das Wort wird wie
 *   der Text zerlegt: „B-1" ist die Phrase `b 1`, und ihr LETZTES Token ist ein Wortanfang
 *   (`"B-1"*`). „Deich" trifft „Deichbruch", nicht „Hochdeich".
 * - **Faltung wie `unicode61`** (`migrations/0004_etb.sql`, Standardoptionen): Groß/Klein egal;
 *   ein lateinischer Buchstabe mit GENAU einem Diakritikum verliert es („Gebaude" trifft
 *   „Gebäude"), mit zweien bleibt er ganz (`remove_diacritics=1`). Andere Schriften, „ß", „Ø"
 *   und „Ł" bleiben, wie sie sind; „ς" wird „σ". Ein einzeln stehendes Diakritikum zählt zum
 *   Wort, trägt aber nichts bei. Tokens sind Buchstaben, Ziffern und Privatzeichen, alles andere
 *   trennt.
 *
 * Bewusst nicht nachgebaut: unicode61 verwirft einzeln stehende Diakritika nur aus einem Teil von
 * U+0300–U+0331 und behandelt andere als Trenner oder Wortteil (Thai, Arabisch). Für Text in
 * lateinischer Schrift ändert das nichts; dort markiert die Hilfe genau, was der Server trifft.
 *
 * Die Suche verknüpft die Phrasen mit UND über alle Spalten; markiert wird jede Fundstelle jeder
 * Phrase, in jedem Feld für sich. Die Fälle in `volltextFundstellen.test.ts` sind gegen SQLite 3.45
 * mit FTS5 nachgemessen.
 */

/** Klasse der Markierung (`<mark>`), Regel in `index.css`; für Text und Markdown dieselbe. */
export const FUNDSTELLE_KLASSE = 'lfh-fundstelle';

/** Eine Phrase: ihre gefalteten Tokens; das letzte gilt als Wortanfang. */
export type Suchphrase = readonly string[];

/** Ein Bereich im Originaltext, als UTF-16-Versatz wie `String.prototype.slice`. */
export interface Fundstelle {
  start: number;
  ende: number;
}

/** Ein Stück des Textes, markiert oder nicht. */
export interface Textstueck {
  text: string;
  fund: boolean;
}

const DIAKRITIKUM = /\p{Mn}/u;
const LATEINISCH = /\p{Script=Latin}/u;
const TOKENZEICHEN = /[\p{L}\p{N}\p{Co}]/u;
/** Rusts `char::is_alphanumeric`: Alphabetic oder Numeric (`fts_query`, Filter je Wort). */
const ALPHANUMERISCH = /[\p{Alphabetic}\p{N}]/u;

/** Gefaltete Form EINES Codepunkts, leer für ein einzeln stehendes Diakritikum. */
function falte(zeichen: string): string {
  if (DIAKRITIKUM.test(zeichen)) return '';
  const [basis, ...marken] = Array.from(zeichen.normalize('NFD'));
  const ohne =
    marken.length === 1 && DIAKRITIKUM.test(marken[0]) && LATEINISCH.test(basis) ? basis : zeichen;
  // Das Schluss-Sigma faltet unicode61 auf σ, `toLowerCase` lässt es stehen.
  return ohne === 'ς' ? 'σ' : ohne.toLowerCase();
}

interface Token {
  start: number;
  /** Gefaltete Form. */
  wort: string;
  /** `ende[i]`: Versatz im Original hinter dem Zeichen, das `wort[i]` beiträgt. */
  ende: number[];
}

function zerlege(text: string): Token[] {
  const tokens: Token[] = [];
  let aktuell: Token | null = null;
  let pos = 0;
  for (const zeichen of text) {
    const nach = pos + zeichen.length;
    if (DIAKRITIKUM.test(zeichen) || TOKENZEICHEN.test(zeichen)) {
      aktuell ??= { start: pos, wort: '', ende: [] };
      const gefaltet = falte(zeichen);
      if (gefaltet === '') {
        // Gehört zum Zeichen davor: die Markierung zerschnitte sonst ein „a" + „¨".
        if (aktuell.ende.length > 0) aktuell.ende[aktuell.ende.length - 1] = nach;
      } else {
        aktuell.wort += gefaltet;
        for (let i = 0; i < gefaltet.length; i++) aktuell.ende.push(nach);
      }
    } else if (aktuell) {
      tokens.push(aktuell);
      aktuell = null;
    }
    pos = nach;
  }
  if (aktuell) tokens.push(aktuell);
  return tokens.filter((t) => t.wort.length > 0);
}

/** Die Phrasen einer Sucheingabe, wie `fts_query` sie bildet. */
export function suchphrasen(eingabe: string): Suchphrase[] {
  return eingabe
    .split(/\s+/u)
    .filter((wort) => ALPHANUMERISCH.test(wort))
    .map((wort) => zerlege(wort).map((t) => t.wort))
    .filter((phrase) => phrase.length > 0);
}

/** Alle Fundstellen der Phrasen in `text`, aufsteigend und ohne Überlappung. */
export function fundstellen(text: string, phrasen: readonly Suchphrase[]): Fundstelle[] {
  if (phrasen.length === 0 || text === '') return [];
  const tokens = zerlege(text);
  const roh: Fundstelle[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const phrase of phrasen) {
      const letztes = i + phrase.length - 1;
      if (letztes >= tokens.length) continue;
      const passt = phrase.every((teil, j) =>
        j === phrase.length - 1 ? tokens[i + j].wort.startsWith(teil) : tokens[i + j].wort === teil,
      );
      if (!passt) continue;
      const anfang = phrase[phrase.length - 1].length;
      roh.push({ start: tokens[i].start, ende: tokens[letztes].ende[anfang - 1] });
    }
  }
  roh.sort((a, b) => a.start - b.start || b.ende - a.ende);
  const ergebnis: Fundstelle[] = [];
  for (const f of roh) {
    const letzte = ergebnis[ergebnis.length - 1];
    if (letzte && f.start <= letzte.ende) letzte.ende = Math.max(letzte.ende, f.ende);
    else ergebnis.push({ ...f });
  }
  return ergebnis;
}

/**
 * Teilt `text` an den Fundstellen. Vor `ab` wird nicht markiert: dort steht, was nicht aus dem
 * durchsuchten Feld stammt (die Nummer vor dem Inhalt einer Palettenzeile).
 */
export function zerlegeNachFundstellen(
  text: string,
  phrasen: readonly Suchphrase[],
  ab = 0,
): Textstueck[] {
  const stuecke: Textstueck[] = [];
  let pos = 0;
  for (const f of fundstellen(text.slice(ab), phrasen)) {
    const start = f.start + ab;
    if (start > pos) stuecke.push({ text: text.slice(pos, start), fund: false });
    stuecke.push({ text: text.slice(start, f.ende + ab), fund: true });
    pos = f.ende + ab;
  }
  if (pos < text.length || stuecke.length === 0)
    stuecke.push({ text: text.slice(pos), fund: false });
  return stuecke;
}
