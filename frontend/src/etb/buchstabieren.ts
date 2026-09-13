/**
 * Buchstabieralphabet als Eingabehilfe (LFH-110). Reine, framework-freie Logik:
 * zu einem Text die zeichenweise Buchstabierung liefern. Additiv, kein Speicherformat.
 *
 * `din5009` = klassische deutsche Buchstabiertafel (BOS-üblich, Anton/Berta/…),
 * `nato` = internationales Funkalphabet (Alfa/Bravo/…).
 */
export type Buchstabiertafel = 'din5009' | 'nato';

/** Klassische deutsche Buchstabiertafel inkl. Umlaute/ß und Ziffern. */
const DIN5009: Record<string, string> = {
  a: 'Anton',
  ä: 'Ärger',
  b: 'Berta',
  c: 'Cäsar',
  d: 'Dora',
  e: 'Emil',
  f: 'Friedrich',
  g: 'Gustav',
  h: 'Heinrich',
  i: 'Ida',
  j: 'Julius',
  k: 'Kaufmann',
  l: 'Ludwig',
  m: 'Martha',
  n: 'Nordpol',
  o: 'Otto',
  ö: 'Ökonom',
  p: 'Paula',
  q: 'Quelle',
  r: 'Richard',
  s: 'Samuel',
  ß: 'Eszett',
  t: 'Theodor',
  u: 'Ulrich',
  ü: 'Übermut',
  v: 'Viktor',
  w: 'Wilhelm',
  x: 'Xanthippe',
  y: 'Ypsilon',
  z: 'Zacharias',
  '0': 'Null',
  '1': 'Eins',
  '2': 'Zwei',
  '3': 'Drei',
  '4': 'Vier',
  '5': 'Fünf',
  '6': 'Sechs',
  '7': 'Sieben',
  '8': 'Acht',
  '9': 'Neun',
};

/** Internationales Funkalphabet (NATO/ICAO). */
const NATO: Record<string, string> = {
  a: 'Alfa',
  b: 'Bravo',
  c: 'Charlie',
  d: 'Delta',
  e: 'Echo',
  f: 'Foxtrot',
  g: 'Golf',
  h: 'Hotel',
  i: 'India',
  j: 'Juliett',
  k: 'Kilo',
  l: 'Lima',
  m: 'Mike',
  n: 'November',
  o: 'Oscar',
  p: 'Papa',
  q: 'Quebec',
  r: 'Romeo',
  s: 'Sierra',
  t: 'Tango',
  u: 'Uniform',
  v: 'Victor',
  w: 'Whiskey',
  x: 'X-ray',
  y: 'Yankee',
  z: 'Zulu',
  '0': 'Zero',
  '1': 'One',
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
};

export interface BuchstabierZeichen {
  /** Das Original-Zeichen (Groß-/Kleinschreibung erhalten). */
  zeichen: string;
  /** Das Buchstabierwort, oder `null` für nicht-buchstabierbare Zeichen (Leerzeichen, Sonderzeichen). */
  wort: string | null;
}

/**
 * Zerlegt `text` zeichenweise in Buchstabier-Einträge. Groß-/Kleinschreibung des
 * Original-Zeichens bleibt erhalten; das Mapping ist case-insensitiv. Nicht in der
 * Tafel enthaltene Zeichen erhalten `wort: null` (werden durchgereicht, nicht verworfen).
 */
export function buchstabiere(
  text: string,
  tafel: Buchstabiertafel = 'din5009',
): BuchstabierZeichen[] {
  const tab = tafel === 'nato' ? NATO : DIN5009;
  return [...text].map((zeichen) => ({ zeichen, wort: tab[zeichen.toLowerCase()] ?? null }));
}
