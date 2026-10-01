/**
 * Die Person formt die Dichte nicht (LFH-724, Spec `bedien-dichte`, „Die Person formt die
 * Dichte nicht“; dazu `bedien-arbeitsplatz`).
 *
 * Quelltext-Wache statt eines Falls je möglicher Quelle: Rolle, Funktion, Führungsstelle und
 * Arbeitsplatz erreichen die Stufe nur über einen Import. `dichte.ts` darf deshalb nichts
 * außer `./tokens` holen — ein Zwischenmodul fiele dort als unbekannter Import auf —, und der
 * Provider nichts aus der Personen- und Einsatzachse. Gelesen per `node:fs` wie die übrigen
 * `*.guard.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = (datei: string) => readFileSync(join(hier, datei), 'utf-8');

/**
 * Alle Modulpfade aus `import … from '…'`, `import '…'` und `export … from '…'` (auch
 * mehrzeilig) sowie aus dynamischem `import('…')`.
 */
function importe(quelltext: string): string[] {
  const statisch = [...quelltext.matchAll(/^(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/gms)];
  const nackt = [...quelltext.matchAll(/^import\s*['"]([^'"]+)['"]/gm)];
  const dynamisch = [...quelltext.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)];
  return [...statisch, ...nackt, ...dynamisch].map((t) => t[1]);
}

/** Die Personen- und Einsatzachse, als handgeschriebene Liste. */
const VERBOTEN = [
  /(^|\/)api\//,
  /(^|\/)auth\//,
  /(^|\/)einsatz\//,
  /(^|\/)fuehrung\//,
  /(^|\/)stab\//,
  /^react-router/,
];

describe('Bediendichte — keine Personenquelle (LFH-724)', () => {
  it('dichte.ts importiert nur ./tokens', () => {
    expect(importe(lies('dichte.ts'))).toEqual(['./tokens']);
  });

  it('der Provider importiert nichts aus der Personen- und Einsatzachse', () => {
    const gefunden = importe(lies('ThemeModeProvider.tsx'));
    // Selbstbeweis der Zerlegung: ohne Treffer prüfte die zweite Erwartung nichts.
    expect(gefunden).toContain('./dichte');
    expect(gefunden.filter((pfad) => VERBOTEN.some((muster) => muster.test(pfad)))).toEqual([]);
  });
});
