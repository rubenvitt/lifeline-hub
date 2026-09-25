import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Der Druck des Meldebilds (LFH-338 · C3, LFH-330 · B2, seit LFH-71 über `druck/druck.css`).
 *
 * Geprüft wird die CSS-QUELLE (Bauform von `lageberichtPrint.test.ts`): jsdom lädt diese
 * Datei nicht und kennt kein `@media print`. Ob die Tabellen-Neutralisierer WIRKEN, misst
 * `e2e/meldebild-tabelle.spec.ts`; hier steht, dass sie dastehen und dass die Datei die
 * gemeinsame Mechanik nicht ein zweites Mal trägt.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const DATEI = 'kraefteuebersichtPrint.css';
const css = readFileSync(join(HIER, DATEI), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Inhalt des (einzigen) `@media print`-Blocks, klammerbalanciert. */
function druckBlock(): string {
  const start = css.indexOf('@media print');
  expect(start, '@media print nicht gefunden').toBeGreaterThanOrEqual(0);
  const auf = css.indexOf('{', start);
  let tiefe = 0;
  for (let i = auf; i < css.length; i++) {
    if (css[i] === '{') tiefe++;
    else if (css[i] === '}' && --tiefe === 0) return css.slice(auf + 1, i);
  }
  throw new Error(`${DATEI}: unbalancierte Klammern im @media print`);
}

interface Regel {
  selektor: string;
  koerper: string;
}

function regeln(): Regel[] {
  return [...druckBlock().matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selektor: m[1].trim().replace(/\s+/g, ' '),
    koerper: m[2].trim().replace(/\s+/g, ' '),
  }));
}

function mit(selektor: string): Regel | undefined {
  return regeln().find((r) =>
    r.selektor
      .split(',')
      .map((s) => s.trim())
      .includes(selektor),
  );
}

describe('kraefteuebersichtPrint.css — Eigenheiten des Meldebilds bleiben', () => {
  it('blendet die Bedienung aus (`kraefte-no-print`, Werkzeugzeile des Primitivs)', () => {
    expect(mit('.kraefte-no-print')?.koerper).toMatch(/display:\s*none\s*!important/);
    expect(mit(".kraefte-print-root [data-lfh='datensicht-werkzeuge']")?.koerper).toMatch(
      /display:\s*none\s*!important/,
    );
  });

  it('neutralisiert Bildlaufcontainer, stehende Kopfzeile und fixierte Spalten der Tabelle', () => {
    expect(mit('.kraefte-print-root .ant-table-body')?.koerper).toMatch(
      /overflow:\s*visible\s*!important/,
    );
    expect(mit('.kraefte-print-root .ant-table-sticky-holder')?.koerper).toMatch(
      /position:\s*static\s*!important/,
    );
    expect(mit('.kraefte-print-root .ant-table-sticky-scroll')?.koerper).toMatch(
      /display:\s*none\s*!important/,
    );
    expect(mit('.kraefte-print-root .ant-table-cell-fix-start')?.koerper).toMatch(
      /position:\s*static\s*!important/,
    );
    expect(mit('.kraefte-print-root .ant-table-body table')?.koerper).toMatch(
      /width:\s*100%\s*!important/,
    );
  });
});

describe('kraefteuebersichtPrint.css — die Mechanik liegt in `druck/druck.css` (LFH-71)', () => {
  it('blendet nichts per visibility aus', () => {
    expect(css).not.toMatch(/visibility\s*:/);
  });

  it('nimmt den Druckbereich nicht aus dem Fluss', () => {
    expect(css).not.toMatch(/position:\s*absolute/);
  });

  it('setzt keine zweite Umbruch- oder Tabellenkopfregel', () => {
    // `thead { display: table-header-group }` und `tr { break-inside: avoid }` stehen seit
    // LFH-71 für alle Druckstücke in `druck.css`.
    expect(css).not.toMatch(/break-(after|before|inside)\s*:/);
    expect(css).not.toMatch(/table-header-group/);
  });

  it('setzt die Druckwurzel-Marke an `.kraefte-print-root`', () => {
    const seite = readFileSync(join(HIER, 'KraefteuebersichtPage.tsx'), 'utf8');
    expect(seite).toMatch(/className="kraefte-print-root"\s+data-lfh="druckwurzel"/);
  });
});
