import { textBreite } from './textBreite';

/**
 * Mindestbreite eines Tabellenkopfs (LLH-1788), rein und exportiert.
 *
 * Mit stehender Kopfzeile legt rc-table den Kopf in eine EIGENE Tabelle. Ihre colgroup trägt die
 * im Körper gemessenen Breiten; `KatalogTabelle` setzt sie deshalb auf `table-layout: fixed`
 * (`theme/sprache.css`), sonst wüchse ein Kopf mit Sortier- und Filterknopf (48 / 72 px) über seine
 * Körperspalte hinaus und schöbe alle Spalten daneben (gemessen 51 px in der Personalliste,
 * `komfortabel`). Damit der feste Kopf nie gekürzt wird, bekommt jede Spalte vorab diese
 * Mindestbreite: Zellpolster beidseits, das längste Wort des Titels in der Kopfschrift (der Titel
 * darf zwischen Wörtern umbrechen), das Sortiersymbol und der Filterauslöser der Stufe.
 *
 * Gerechnet, nicht am DOM gemessen: so steht die Breite schon im ersten Bild und springt nicht.
 */

/** Typografie des Tabellenkopfs, wie `.lfh-katalog .ant-table-thead > tr > th` in `sprache.css`. */
export const KOPF_SCHRIFT = { groesse: 10, gewicht: 600, sperrung: 0.12 } as const;

/** Breite des Sortiersymbols samt Abstand zum Titel (antd: 12 px Symbol, 4 px Abstand). */
const SORTIER_BREITE = 16;
/** Abstand des Filterauslösers zum Titel (antd `margin-inline-start`). */
const FILTER_ABSTAND = 4;

/** Das längste Wort in Versalien; ein Kopf bricht zwischen Wörtern um, nie in einem. */
export function laengstesWort(titel: string): string {
  return titel
    .toLocaleUpperCase('de-DE')
    .split(/\s+/)
    .reduce((a, b) => (b.length > a.length ? b : a), '');
}

export function kopfMindestBreite({
  titel,
  token,
  messen,
  sortierbar = false,
  filterbar = false,
}: {
  titel: string;
  token: { controlHeightSM: number; padding: number };
  /** Breite eines Texts in der Kopfschrift, Sperrung eingerechnet ({@link textBreiteKopf}). */
  messen: (text: string) => number;
  sortierbar?: boolean;
  filterbar?: boolean;
}): number {
  const wort = laengstesWort(titel);
  const text = wort ? messen(wort) : 0;
  const knoepfe =
    (sortierbar ? SORTIER_BREITE : 0) + (filterbar ? token.controlHeightSM + FILTER_ABSTAND : 0);
  return Math.ceil(2 * token.padding + text + knoepfe);
}

/** Breite eines Texts in der Kopfschrift, Sperrung eingerechnet (`components/textBreite.ts`). */
export function textBreiteKopf(text: string, schriftfamilie: string): number {
  const { groesse, gewicht, sperrung } = KOPF_SCHRIFT;
  return textBreite(text, { schrift: schriftfamilie, groesse, gewicht, sperrung });
}

/**
 * Hebt die Breite einer Spalte auf die Mindestbreite ihres Kopfs (LLH-1788): eine Zahlbreite und
 * das Mindestmaß einer Fließspalte wachsen bei Bedarf, nie schrumpfen sie. Eine Spalte ohne beides
 * bleibt, wie sie ist: dort trägt der Körper seine `max-content`-Breite, und eine erfundene Zahl
 * änderte die Tabellenbreite (`fliessBreite`).
 */
export function mitKopfMindestBreite<S extends { width?: unknown; mindestBreite?: number }>(
  spalte: S,
  mindest: number,
): S {
  if (spalte.mindestBreite != null) {
    return spalte.mindestBreite >= mindest ? spalte : { ...spalte, mindestBreite: mindest };
  }
  if (typeof spalte.width === 'number') {
    return spalte.width >= mindest ? spalte : { ...spalte, width: mindest };
  }
  return spalte;
}
