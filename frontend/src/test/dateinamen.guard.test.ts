import { describe, expect, it } from 'vitest';

/**
 * Guard (LFH-255/F32): verbietet zwei Dateien, die sich nur in der Endung
 * `.ts` vs. `.tsx` unterscheiden.
 *
 * TypeScript nimmt bei gleichem Basename nur EINE der beiden ins Programm (die `.ts`
 * gewinnt). Die andere ist damit für **jedes** Typecheck-Gate unsichtbar — `pnpm
 * typecheck`, der Build und Schritt 4 des Codegen-Drift-Gates (LFH-120) laufen an ihr
 * vorbei —, während Vitest sie ungeprüft ausführt, weil esbuild die Typen nur strippt.
 * Der Test bleibt dann auch dann grün, wenn er längst gegen veraltete Props läuft.
 *
 * Genau das war live: `Sidebar.test.ts` beschattete die 7,8 KB große
 * Komponententestdatei `Sidebar.test.tsx`. Die Fehlerklasse war als Lektion notiert
 * und stand trotzdem im Baum — Konvention allein trägt hier nicht, deshalb ein Guard.
 *
 * Nur die Glob-Schlüssel werden gebraucht, nicht der Inhalt: kein `?raw`, kein `eager`.
 * Das macht den Guard billiger als die beiden Vorbilder (`queryKeys.guard.test.ts`,
 * `schreibrecht.guard.test.ts`).
 */

// `src` deckt den Anwendungscode ab; `e2e` liegt ebenfalls in der tsconfig und
// unterliegt damit derselben Regel.
const dateien = { ...import.meta.glob('/src/**/*.{ts,tsx}'), ...import.meta.glob('/e2e/**/*.{ts,tsx}') };

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
      basenameKollisionen(['/src/a/Sidebar.test.ts', '/src/a/Sidebar.test.tsx', '/src/a/Andere.tsx']),
    ).toEqual([['/src/a/Sidebar.test.ts', '/src/a/Sidebar.test.tsx']]);

    // Gleicher Basename in VERSCHIEDENEN Ordnern ist kein Problem.
    expect(basenameKollisionen(['/src/a/Sidebar.tsx', '/src/b/Sidebar.tsx'])).toEqual([]);
  });
});
