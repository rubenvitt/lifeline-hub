import { describe, expect, it } from 'vitest';

/**
 * Guard: verbietet zwei Dateien, die sich nur in der Endung `.ts` vs. `.tsx` unterscheiden.
 *
 * TypeScript nimmt bei gleichem Basename nur EINE ins Programm (die `.ts` gewinnt). Die andere
 * ist für jedes Typecheck-Gate unsichtbar, während Vitest sie ungeprüft ausführt (esbuild
 * strippt nur) — ein Test liefe dann still gegen veraltete Props.
 *
 * Nur die Glob-Schlüssel werden gebraucht, kein `?raw`, kein `eager`.
 */

// `src` deckt den Anwendungscode ab; `e2e` liegt ebenfalls in der tsconfig und
// unterliegt damit derselben Regel.
const dateien = {
  ...import.meta.glob('/src/**/*.{ts,tsx}'),
  ...import.meta.glob('/e2e/**/*.{ts,tsx}'),
};

/** Findet Pfade, die sich nur in der Endung unterscheiden. */
export function basenameKollisionen(pfade: string[]): string[][] {
  const nachBasename = new Map<string, string[]>();
  for (const pfad of pfade) {
    const basis = pfad.replace(/\.tsx?$/, '');
    nachBasename.set(basis, [...(nachBasename.get(basis) ?? []), pfad]);
  }
  return [...nachBasename.values()].filter((gruppe) => gruppe.length > 1).map((g) => [...g].sort());
}

describe('Dateinamen-Guard: keine .ts/.tsx-Basename-Kollisionen', () => {
  it('findet keine zwei Dateien mit gleichem Basename und unterschiedlicher Endung', () => {
    const pfade = Object.keys(dateien);

    // Sicherung gegen ein kaputtes Glob-Muster: ein leerer Guard wäre still grün.
    expect(pfade.length).toBeGreaterThan(100);

    const kollisionen = basenameKollisionen(pfade);
    expect(
      kollisionen,
      `Diese Dateien beschatten sich gegenseitig — tsc nimmt nur die .ts ins Programm, die .tsx ` +
        `läuft in KEINEM Typecheck-Gate mit (LFH-255/F32). Eine der beiden umbenennen:\n` +
        kollisionen.map((g) => g.join('  ↔  ')).join('\n'),
    ).toEqual([]);
  });

  it('erkennt eine Kollision tatsächlich (Selbst-Beweis)', () => {
    // Ein Guard, der nur per Konstruktion grün ist, sagt nichts aus.
    expect(
      basenameKollisionen([
        '/src/a/Sidebar.test.ts',
        '/src/a/Sidebar.test.tsx',
        '/src/a/Andere.tsx',
      ]),
    ).toEqual([['/src/a/Sidebar.test.ts', '/src/a/Sidebar.test.tsx']]);

    // Gleicher Basename in VERSCHIEDENEN Ordnern ist kein Problem.
    expect(basenameKollisionen(['/src/a/Sidebar.tsx', '/src/b/Sidebar.tsx'])).toEqual([]);
  });
});
