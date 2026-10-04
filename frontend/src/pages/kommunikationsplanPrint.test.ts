import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Eigenheiten des Kommunikationsplans im Druck (LFH-848, D6). Geprüft wird die CSS-Quelle,
 * jsdom kennt kein `@media print`. Die Mechanik steht in `druck/druck.css`; ob sie am Plan wirkt,
 * misst `e2e/kommunikationsplan.spec.ts`.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HIER, 'kommunikationsplanPrint.css'), 'utf8').replace(
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

describe('kommunikationsplanPrint.css', () => {
  it('blendet die eigene Bedienung und den Seitenkopf aus', () => {
    expect(regelKoerper('.kommunikationsplan-no-print')).toMatch(/display:\s*none\s*!important/);
    expect(regelKoerper(".kommunikationsplan-print-root [data-lfh='seitenkopf']")).toMatch(
      /display:\s*none\s*!important/,
    );
  });

  it('trägt keine Mechanik ein zweites Mal', () => {
    expect(css).not.toMatch(/visibility\s*:/);
    expect(css).not.toMatch(/position:\s*absolute/);
    expect(css).not.toMatch(/break-(after|before|inside)\s*:/);
    expect(css).not.toContain('ant-table');
  });

  it('die Seite trägt die Druckwurzel und das Blatt', () => {
    const seite = readFileSync(join(HIER, 'KommunikationsplanPage.tsx'), 'utf8');
    expect(seite).toMatch(/className="kommunikationsplan-print-root"\s+data-lfh="druckwurzel"/);
    expect(seite).toContain("import './kommunikationsplanPrint.css';");
    expect(seite).toMatch(/<Druckkopf\s+dokumentart="Kommunikationsplan"/);
    // Die Aktionsspalte fehlt im Druck schon in der Seite, nicht erst per CSS.
    expect(seite).toMatch(/const mitAktionen = darfSchreiben && !druckt;/);
  });
});
