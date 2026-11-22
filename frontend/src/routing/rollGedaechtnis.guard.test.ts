import { describe, expect, it } from 'vitest';
import { type AstNode, parseSource, staticText, walk } from '../lib/sourceAst';
import { ZIEL_PARAMETER } from './rollGedaechtnis';
import { MELDEBILD_PARAMETER } from '../kraefte/useMeldebildFilter';

/**
 * Wächter zur Rollposition (LLH-1826, Regel `frontend/AGENTS.md`, „Rollposition beim Zurück“):
 * Die Wiederherstellung hält still, wenn die Adresse ein Deeplink-Ziel trägt (`traegtZiel`).
 * Dafür muss jeder Schlüssel, den eine Seite über `useQueryParamSelektion` ansteuert, in
 * `ZIEL_PARAMETER` stehen, und kein Filter in der Adresse darf denselben Namen tragen: sonst
 * stellte eine gefilterte Liste ihre Position nie wieder her.
 */

const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const istTestdatei = (pfad: string): boolean => /\.(type)?test\.tsx?$/.test(pfad);

/** Erste Argumente (Literal) der Aufrufe, deren Name `passt`. */
export function literaleDerAufrufe(
  pfad: string,
  quelltext: string,
  passt: (name: string) => boolean,
): string[] {
  const funde: string[] = [];
  walk(parseSource(pfad, quelltext), (knoten) => {
    if (knoten.type !== 'CallExpression') return;
    const callee = knoten.callee as AstNode;
    if (callee.type === 'Identifier' && passt(callee.name as string)) {
      const erstes = staticText((knoten.arguments as AstNode[])[0]);
      if (erstes !== undefined) funde.push(erstes);
    }
  });
  return funde;
}

const QUELLEN = Object.entries(dateien).filter(([pfad]) => !istTestdatei(pfad));
const sammle = (passt: (name: string) => boolean) =>
  new Set(QUELLEN.flatMap(([pfad, inhalt]) => literaleDerAufrufe(pfad, inhalt, passt)));

describe('Rollposition: Deeplink-Ziele (LLH-1826)', () => {
  it('erkennt Aufrufe über mehrere Zeilen und nur mit Literal (Selbstbeweis)', () => {
    const quelle = `
      useQueryParamSelektion(
        'meldung',
        bereit,
        () => {},
      );
      useQueryParamSelektion(SCHLUESSEL, bereit, () => {});
      useAdressWert('richtung', ERLAUBT, 'alle');
    `;
    expect(literaleDerAufrufe('/src/x.tsx', quelle, (n) => n === 'useQueryParamSelektion')).toEqual(
      ['meldung'],
    );
    expect(literaleDerAufrufe('/src/x.tsx', quelle, (n) => n.startsWith('useAdress'))).toEqual([
      'richtung',
    ]);
  });

  it('jeder Schlüssel von useQueryParamSelektion steht in ZIEL_PARAMETER', () => {
    const ziele = sammle((n) => n === 'useQueryParamSelektion');
    expect(ziele.size, 'kein Aufruf gefunden: der Scanner sieht nichts').toBeGreaterThan(0);
    const fehlt = [...ziele].filter((z) => !(ZIEL_PARAMETER as readonly string[]).includes(z));
    expect(fehlt, 'in routing/rollGedaechtnis.ts ZIEL_PARAMETER ergänzen').toEqual([]);
  });

  it('kein Filter in der Adresse trägt den Namen eines Deeplink-Ziels', () => {
    const filter = new Set([...sammle((n) => n.startsWith('useAdress')), ...MELDEBILD_PARAMETER]);
    const doppelt = [...filter].filter((f) => (ZIEL_PARAMETER as readonly string[]).includes(f));
    expect(doppelt).toEqual([]);
  });
});
