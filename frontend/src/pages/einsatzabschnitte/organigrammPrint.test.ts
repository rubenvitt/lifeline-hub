import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Eigenheiten des Organigramms im Druck (LFH-626, D6). Geprüft wird die CSS-Quelle, jsdom
 * kennt kein `@media print`; ob sie wirkt, misst `e2e/fuehrungsorganisation.spec.ts`.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HIER, 'organigrammPrint.css'), 'utf8').replace(
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

describe('organigrammPrint.css', () => {
  it('steht ganz unter @media print', () => {
    expect(css.trim().startsWith('@media print')).toBe(true);
  });

  it('blendet Bedienung und Klappziele aus', () => {
    expect(regelKoerper('.organigramm-no-print')).toMatch(/display:\s*none\s*!important/);
    expect(regelKoerper(".organigramm-print-root [data-lfh='org-klappen']")).toMatch(
      /display:\s*none\s*!important/,
    );
    expect(regelKoerper(".organigramm-print-root [data-lfh='org-klappen-platz']")).toMatch(
      /display:\s*none\s*!important/,
    );
  });

  it('setzt A4 auf zwei feste Spalten', () => {
    expect(regelKoerper(".organigramm-print-root [data-lfh='org-ebene1']")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/,
    );
  });

  it('bricht zwischen Knoten, nicht in einem Knoten', () => {
    expect(regelKoerper(".organigramm-print-root [data-lfh='org-ebene1'] ul")).toMatch(
      /break-inside:\s*auto/,
    );
    expect(regelKoerper(".organigramm-print-root [data-lfh='org-knoten']")).toMatch(
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
