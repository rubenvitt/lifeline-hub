import { describe, expect, it } from 'vitest';

/**
 * Wächter (LLH-1824, `docs/anwender/AGENTS.md`, „Hilfe in der App“): was Kopf, Palette und
 * Einsatzliste laden, zieht die Kapiteltexte nicht in den Haupt-Chunk. Die Leiste selbst kommt nur
 * per `import()` aus dem Hilfe-Chunk.
 */
const QUELLEN = import.meta.glob<string>(
  [
    './kontextKapitel.ts',
    './tastenkuerzel.ts',
    './willkommen.ts',
    './HilfeSeitenleisteProvider.tsx',
    './HilfeKnopf.tsx',
    './WillkommenKarte.tsx',
    '../command-palette/befehle.ts',
    '../command-palette/typen.ts',
    '../command-palette/useBefehle.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);

const STATISCH_VERBOTEN =
  /from\s+['"](?:\.\.\/hilfe|\.)\/(kapitel|HilfePage|HilfeSeitenleiste)['"]/;

describe('Haupt-Chunk ohne Kapiteltexte', () => {
  it('liest alle geprüften Quellen', () => {
    expect(Object.keys(QUELLEN)).toHaveLength(9);
  });

  it.each(Object.entries(QUELLEN))('%s importiert keine Kapiteltexte statisch', (_pfad, text) => {
    expect(text).not.toMatch(STATISCH_VERBOTEN);
  });

  it('der Provider lädt die Leiste nur dynamisch', () => {
    const provider = QUELLEN['./HilfeSeitenleisteProvider.tsx'];
    expect(provider).toMatch(/import\(\s*['"]\.\/HilfeSeitenleiste['"]\s*\)/);
  });
});
