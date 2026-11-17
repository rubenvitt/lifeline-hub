/**
 * Umbruch an Wort- und Silbengrenzen statt mitten im Wort (Entscheidung 14.10.2026, LLH-1073;
 * LLH-1793). `hyphens: 'auto'` braucht die Sprache am Element oder darüber (`lang="de"` steht in
 * `index.html`). `wordBreak: 'normal'` hebt antds `word-break: break-word` an `Typography` auf,
 * das „Transportbereitstell/ung“ ohne Trennstrich bricht. `overflowWrap: 'break-word'` bricht ein
 * Wort nur noch, wenn es auch getrennt nicht in die Zeile passt.
 *
 * Nicht `overflowWrap: 'anywhere'`: das senkt die Mindestbreite eines Namens auf ein Zeichen, und
 * eine enge Tabellenspalte setzt ihn Buchstabe für Buchstabe senkrecht (LLH-1787).
 */
export const WORTUMBRUCH_STIL = {
  overflowWrap: 'break-word',
  hyphens: 'auto',
  wordBreak: 'normal',
} as const;
