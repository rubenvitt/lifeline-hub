import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Druckregeln des hängenden Gerüsts (LFH-626 D6, geteilt seit LFH-625 D4). Geprüft wird die
 * CSS-Quelle, jsdom kennt kein `@media print`; ob sie wirkt, messen
 * `e2e/fuehrungsorganisation.spec.ts` und `e2e/funkplan.spec.ts`.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HIER, 'haengenderBaumPrint.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function regelKoerper(selektor: string): string | undefined {
  const start = css.indexOf('@media print');
  const block = css.slice(css.indexOf('{', start) + 1);
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selektoren = m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (selektoren.includes(selektor)) return m[2].trim();
  }
  return undefined;
}

describe('haengenderBaumPrint.css', () => {
  it('steht ganz unter @media print', () => {
    expect(css.trim().startsWith('@media print')).toBe(true);
  });

  it('blendet die Klappziele und ihre Platzhalter aus', () => {
    expect(regelKoerper(".haengender-baum [data-lfh='org-klappen']")).toMatch(
      /display:\s*none\s*!important/,
    );
    expect(regelKoerper(".haengender-baum [data-lfh='org-klappen-platz']")).toMatch(
      /display:\s*none\s*!important/,
    );
  });

  it('setzt A4 auf zwei feste Spalten', () => {
    expect(regelKoerper(".haengender-baum [data-lfh='org-ebene1']")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/,
    );
  });

  it('bricht zwischen Knoten, nicht in einem Knoten', () => {
    // Auch die äußere Liste selbst: `druck.css` hält jedes `ul` zusammen, sonst rutschte das
    // ganze Grid auf Seite 2 (Review LFH-626).
    expect(regelKoerper(".haengender-baum [data-lfh='org-ebene1']")).toMatch(
      /break-inside:\s*auto/,
    );
    expect(regelKoerper(".haengender-baum [data-lfh='org-ebene1'] ul")).toMatch(
      /break-inside:\s*auto/,
    );
    expect(regelKoerper(".haengender-baum [data-lfh='org-knoten']")).toMatch(
      /break-inside:\s*avoid/,
    );
  });

  it('trägt keine Mechanik von druck.css ein zweites Mal', () => {
    expect(css).not.toMatch(/visibility\s*:/);
    expect(css).not.toMatch(/position:\s*absolute/);
    expect(css).not.toMatch(/@page/);
    expect(css).not.toContain('druckwurzel');
  });
});
