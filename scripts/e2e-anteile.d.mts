/**
 * Typen für `e2e-anteile.mjs`, soweit `frontend/playwright.config.ts` sie nutzt: der Typecheck des
 * Frontends erfasst die Playwright-Configs (`frontend/tsconfig.json`, LLH-1458).
 */

/** Eine Verteilungseinheit: Playwright-Projekt und Spec-Datei relativ zum `testDir`. */
export interface Einheit {
  projekt: string;
  datei: string;
}

/** Gemessene Laufzeit je Projekt und Spec-Datei (`frontend/e2e/laufzeiten.json`). */
export type Laufzeiten = Record<string, Record<string, number>>;

export function leseAnteil(text: string): { nummer: number; gesamt: number };

export function verteile<E extends Einheit>(
  einheiten: readonly E[],
  laufzeiten: Laufzeiten,
  gesamt: number,
): E[][];
