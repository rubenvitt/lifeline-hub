import { describe, expect, it } from 'vitest';
import { ENGE_ARTEN, scanneQueryKeys, type Fund } from './queryKeyScan';

/**
 * Unit-Tests des AST-Scanners (LFH-312, AP3) gegen SYNTHETISCHE Fixtures.
 *
 * Warum Fixtures statt Bestandsjagd: der Bestand ist per Definition sauber (sonst wäre der
 * Guard rot) und kann einen NEUEN Fangfall deshalb gar nicht belegen. Eine Fixture wandert
 * außerdem bei einem Refactor nicht davon. Die drei Regex-Blindflecken (mehrzeilig, Kommentar,
 * Quote-Stil) werden hier als Verhalten festgenagelt, nicht bloß im Kommentar behauptet.
 */

const prefixe = (funde: Fund[]): string[] => funde.map((f) => f.prefix);
const art = (funde: Fund[], prefix: string): string | undefined =>
  funde.find((f) => f.prefix === prefix)?.art;

describe('queryKeyScan: Grundformen', () => {
  it('meldet ein einzeiliges queryKey-Literal mit Kontext-Art', () => {
    const funde = scanneQueryKeys('/src/x.ts', `useQuery({ queryKey: ['einsatz-uhs', id] });`);
    expect(prefixe(funde)).toEqual(['einsatz-uhs']);
    expect(art(funde, 'einsatz-uhs')).toBe('queryKey');
  });

  it('meldet mutationKey', () => {
    const funde = scanneQueryKeys('/src/x.ts', `useMutation({ mutationKey: ['foo'] });`);
    expect(art(funde, 'foo')).toBe('mutationKey');
  });

  it('erfasst invalidateQueries in BEIDEN Formen', () => {
    // v5-Objektform (die im Bestand durchgängig genutzte) …
    const v5 = scanneQueryKeys('/src/x.ts', `qc.invalidateQueries({ queryKey: ['a-key'] });`);
    expect(art(v5, 'a-key')).toBe('queryKey');
    // … und die v4-Form mit Array als erstem Argument.
    const v4 = scanneQueryKeys('/src/x.ts', `qc.invalidateQueries(['b-key']);`);
    expect(art(v4, 'b-key')).toBe('cache-call');
  });

  it('meldet NICHT, wenn Position 0 ein Identifier/PropertyAccess ist (die erwünschte Form)', () => {
    const funde = scanneQueryKeys(
      '/src/x.ts',
      `useQuery({ queryKey: [EINSATZ_KEYS.uhs, id] });\nconst k = [prefix, id];`,
    );
    expect(funde).toEqual([]);
  });
});

describe('queryKeyScan: die drei Regex-Blindflecken', () => {
  it('BLINDFLECK 1 — findet ein MEHRZEILIGES Literal (Regex war zeilenlokal)', () => {
    const quelle = `useQuery({\n  queryKey: [\n    'einsatz-uhs',\n    id,\n  ],\n});`;
    const funde = scanneQueryKeys('/src/x.ts', quelle);
    expect(prefixe(funde)).toEqual(['einsatz-uhs']);
    expect(funde[0].zeile).toBe(2); // Zeile des Array-Literals, nicht des Strings
  });

  it('BLINDFLECK 2 — Kommentare erzeugen keinen Fehlalarm (auch ohne `*`-Präfix)', () => {
    // Die alte `istKommentarzeile`-Heuristik traf nur `//`, `*`, `/*` am Zeilenanfang; ein
    // eingerückter Block-Kommentar-Rumpf ohne `*` rutschte durch. Im AST gibt es den Knoten nicht.
    const quelle = `/*\n  historisch: queryKey: ['einsatz-uhs', id]\n*/\nconst x = 1;`;
    expect(scanneQueryKeys('/src/x.ts', quelle)).toEqual([]);
  });

  it('BLINDFLECK 3 — doppelt-quotiertes Literal wird gefunden', () => {
    // Akzeptanzpunkt des Tickets. Reale Fundstellen: 0 (Prettier erzwingt Single-Quotes), der
    // Nachweis ist deshalb bewusst synthetisch. Er ist trotzdem aussagekräftig: der Scanner
    // fragt `ts.isStringLiteralLike`, für den der Quote-Stil gar nicht existiert — anders als
    // bei der alten Regex, die `'` hart kodierte und `"` strukturell nie sehen konnte.
    const funde = scanneQueryKeys('/src/x.ts', `useQuery({ queryKey: ["einsatz-uhs", id] });`);
    expect(prefixe(funde)).toEqual(['einsatz-uhs']);
  });
});

describe('queryKeyScan: Radius-Pinning (WEIT vs. ENG)', () => {
  it('WEIT fängt die Extraktion in eine Konstante — Deckung für Guard (a)/(c)/(e)', () => {
    const funde = scanneQueryKeys('/src/x.ts', `const K = ['einsatz-uhs', id];`);
    expect(prefixe(funde)).toEqual(['einsatz-uhs']);
    expect(art(funde, 'einsatz-uhs')).toBe('array-literal');
  });

  it('ENG lässt eine gewöhnliche String-Array-Konstante in Ruhe — kein Fehlalarm für Guard (f)', () => {
    const funde = scanneQueryKeys('/src/x.ts', `const EINHEITEN = ['KB', 'MB', 'GB', 'TB'];`);
    expect(prefixe(funde)).toEqual(['KB']); // WEIT sieht sie …
    expect(funde.filter((f) => ENGE_ARTEN.includes(f.art))).toEqual([]); // … ENG nicht.
  });
});

describe('queryKeyScan: Indirektion über lokale Key-Helfer', () => {
  it('sieht ein bare String-Literal, das in einen Key-Helfer fließt (LFH-122/215-Blindfleck)', () => {
    // Muster aus live/useEinsatzLiveStream.ts:48. Das Literal steht in KEINEM Array —
    // keine `[\s*'`-Regex der Welt konnte es sehen.
    const quelle = [
      `const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });`,
      `inval('einsatz-uhs');`,
    ].join('\n');
    const funde = scanneQueryKeys('/src/x.ts', quelle);
    expect(prefixe(funde)).toEqual(['einsatz-uhs']);
    expect(art(funde, 'einsatz-uhs')).toBe('schluessel-helfer-arg');
  });

  it('meldet den registry-basierten Aufruf NICHT', () => {
    const quelle = [
      `const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });`,
      `inval(EINSATZ_KEYS.auftraege);`,
    ].join('\n');
    expect(scanneQueryKeys('/src/x.ts', quelle)).toEqual([]);
  });

  it('hält den Parameterindex auseinander', () => {
    const quelle = [
      `function laden(scope: string, key: string) { return qc.getQueryData([key, scope]); }`,
      `laden('nicht-der-key', 'einsatz-uhs');`,
    ].join('\n');
    const funde = scanneQueryKeys('/src/x.ts', quelle);
    expect(prefixe(funde)).toEqual(['einsatz-uhs']); // Argument 1, nicht Argument 0
  });
});

describe('queryKeyScan: dynamischer Prefix', () => {
  it('meldet ein Template-Literal MIT Platzhalter an Position 0', () => {
    const funde = scanneQueryKeys('/src/x.ts', 'useQuery({ queryKey: [`einsatz-${modul}`, id] });');
    expect(funde.map((f) => f.art)).toEqual(['dynamischer-prefix']);
  });

  it('behandelt ein Template OHNE Platzhalter als statischen Prefix', () => {
    const funde = scanneQueryKeys('/src/x.ts', 'useQuery({ queryKey: [`einsatz-uhs`, id] });');
    expect(prefixe(funde)).toEqual(['einsatz-uhs']);
    expect(art(funde, 'einsatz-uhs')).toBe('queryKey');
  });
});

describe('queryKeyScan: TSX', () => {
  it('parst .tsx (Generics-Mehrdeutigkeit) ohne Syntaxfehler-Verlust', () => {
    const quelle = `const C = () => <div>{useQuery({ queryKey: ['einsatz-uhs'] }).data}</div>;`;
    expect(prefixe(scanneQueryKeys('/src/C.tsx', quelle))).toEqual(['einsatz-uhs']);
  });
});
