import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Eigenheiten des Funkplans im Druck (LFH-548, D8). Geprüft wird die CSS-Quelle, jsdom kennt
 * kein `@media print`. Die Mechanik (Rahmen, Fluss, Papier, Umbruch, Tabellen-Neutralisierer)
 * steht in `druck/druck.css`; ob sie am Funkplan wirkt, misst `e2e/funkplan-druck.spec.ts`.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HIER, 'funkplanPrint.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function regelKoerper(selektor: string): string | undefined {
  const start = css.indexOf('@media print');
  const block = css.slice(css.indexOf('{', start) + 1);
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selektoren = m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (selektoren.includes(selektor)) return m[2].trim();
  }
  return undefined;
}

describe('funkplanPrint.css', () => {
  it('blendet die eigene Bedienung und den Seitenkopf aus', () => {
    expect(regelKoerper('.funkplan-no-print')).toMatch(/display:\s*none\s*!important/);
    expect(regelKoerper(".funkplan-print-root [data-lfh='seitenkopf']")).toMatch(
      /display:\s*none\s*!important/,
    );
  });

  // LFH-893 (e2e `fernmeldeskizze-druck.spec.ts`): die Beschreibung stand vor dem quer benannten
  // Skizzenblatt und erzwang eine eigene, fast leere erste Seite im Hochformat.
  it('blendet die Beschreibung des Seitenkopfs aus (Bildschirmhilfe, keine eigene Seite)', () => {
    expect(regelKoerper(".funkplan-print-root [data-lfh='seiten-beschreibung']")).toMatch(
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
    const seite = readFileSync(join(HIER, 'FunkplanPage.tsx'), 'utf8');
    expect(seite).toMatch(/className="funkplan-print-root"\s+data-lfh="druckwurzel"/);
    expect(seite).toContain("import './funkplanPrint.css';");
    // Die Dokumentart folgt der Darstellung (LFH-625): „Funkplan“ bzw. „Fernmeldeskizze“.
    expect(seite).toMatch(
      /<Druckkopf\s+dokumentart=\{ansicht === 'skizze' \? 'Fernmeldeskizze' : 'Funkplan'\}/,
    );
  });
});
