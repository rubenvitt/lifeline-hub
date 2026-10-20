/**
 * JSDoc aus dem Quelltext lesen — für `usage` der Tokens und die README je Baustein
 * (design.md D2/D4). Gelesen wird Text, nicht der Typbaum: die Quellen sind wenige, fest
 * benannte Dateien, und ein fehlender Block fällt beim Erzeugen auf (`docBefore` wirft).
 */

const DOC_BLOCK = /\/\*\*([\s\S]*?)\*\//g;

/** Der Inhalt eines `/** … *\/`-Blocks als Text: Sternchen am Zeilenanfang weg, `{@link X}` → `X`. */
export function cleanDoc(inner: string): string {
  return inner
    .split('\n')
    .map((line) => line.replace(/^\s*\*( ?)/, ''))
    .join('\n')
    .replace(/\{@link\s+([^}\s]+)\s*\}/g, '`$1`')
    .replace(/^\s+|\s+$/g, '');
}

/** Der Block als ein Absatz (Zeilenumbrüche zu Leerzeichen). */
export function flatDoc(inner: string): string {
  return cleanDoc(inner).replace(/\s+/g, ' ').trim();
}

/** Der erste Satz eines Absatzes, für `usage`. Abkürzungen wie „z. B.“ trennen nicht. */
export function firstSentence(text: string): string {
  const match = /^(.+?[.!?])\s+(?=[A-ZÄÖÜ„`(])/.exec(text);
  const sentence = match ? match[1] : text;
  return /z\. ?B\.$|u\. ?a\.$|vgl\.$/.test(sentence) ? text : sentence;
}

/**
 * JSDoc der Mitglieder eines Blocks (`export interface X {` oder `export const X = {`): je
 * Mitgliedsname der Block direkt davor. Ein Block gilt nur für das nächste Mitglied.
 */
export function memberDocs(source: string, head: string): Map<string, string> {
  const start = source.indexOf(head);
  if (start < 0) throw new Error(`Design System: „${head}“ fehlt in der Quelle`);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start + head.length, end);
  const docs = new Map<string, string>();
  let pending: string | null = null;
  let inBlock: string[] | null = null;
  for (const line of body.split('\n')) {
    if (inBlock) {
      inBlock.push(line);
      if (line.includes('*/')) {
        pending = flatDoc(
          inBlock
            .join('\n')
            .replace(/^\s*\/\*\*/, '')
            .replace(/\*\/\s*$/, ''),
        );
        inBlock = null;
      }
      continue;
    }
    const single = /^\s*\/\*\*(.*)\*\/\s*$/.exec(line);
    if (single) {
      pending = flatDoc(single[1]);
      continue;
    }
    if (/^\s*\/\*\*/.test(line)) {
      inBlock = [line];
      continue;
    }
    const member = /^\s*(\w+)\??:/.exec(line);
    if (member) {
      if (pending) docs.set(member[1], pending);
      pending = null;
    }
  }
  return docs;
}

/**
 * Der JSDoc-Block direkt vor der ersten Zeile, die `anchor` enthält; ohne Anker der erste Block
 * der Datei. Wirft, wenn es keinen gibt: eine Baustein-README ohne Quelle wäre erfunden.
 */
export function docBefore(source: string, anchor?: string): string {
  const limit = anchor == null ? source.length : source.indexOf(anchor);
  if (limit < 0) throw new Error(`Design System: Anker „${anchor}“ fehlt in der Quelle`);
  let last: { inner: string; end: number } | null = null;
  for (const match of source.matchAll(DOC_BLOCK)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end > limit) break;
    last = { inner: match[1], end };
    if (anchor == null) break;
  }
  if (!last || (anchor != null && source.slice(last.end, limit).trim().length > 0)) {
    throw new Error(`Design System: kein JSDoc-Block vor „${anchor ?? 'Dateianfang'}“`);
  }
  return cleanDoc(last.inner);
}
