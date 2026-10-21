import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Eigenheiten der Gefahrenseite im Druck (LLH-1364). Geprüft wird die CSS-Quelle, jsdom kennt
 * kein `@media print`. Die Mechanik (Rahmen, Fluss, Papier, Tabellen-Neutralisierer) steht in
 * `druck/druck.css`; ob beides an der Seite wirkt, misst `e2e/gefahren-druck.spec.ts`.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HIER, 'gefahrenPrint.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function regelKoerper(selektor: string): string | undefined {
  const start = css.indexOf('@media print');
  const block = css.slice(css.indexOf('{', start) + 1);
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selektoren = m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (selektoren.includes(selektor)) return m[2].trim();
  }
  return undefined;
}

describe('gefahrenPrint.css', () => {
  it('steht ganz unter @media print', () => {
    expect(css.trim().startsWith('@media print')).toBe(true);
    expect(css.match(/@media/g)).toHaveLength(1);
  });

  it('blendet die Bedienung und den Seitenkopf aus', () => {
    expect(regelKoerper('.gefahren-no-print')).toMatch(/display:\s*none\s*!important/);
    expect(regelKoerper(".gefahren-print-root [data-lfh='seitenkopf']")).toMatch(
      /display:\s*none\s*!important/,
    );
  });

  // Ohne Schraffur stünde „nicht anwendbar“ auf Papier als leere Zelle, kaum von „–“ zu trennen.
  it('druckt die Schraffur „nicht anwendbar“ schwarz, auch ohne Hintergrunddruck', () => {
    for (const selektor of [
      ".gefahren-print-root [data-lfh='nicht-anwendbar']",
      ".gefahren-print-root [data-lfh='legende-schraffur']",
    ]) {
      const regel = regelKoerper(selektor);
      expect(regel, selektor).toMatch(
        /background-image:\s*repeating-linear-gradient\(\s*135deg,\s*black[^;]*!important/,
      );
      expect(regel, selektor).toMatch(/print-color-adjust:\s*exact/);
    }
  });

  it('ein Eintrag der Erläuterungen bricht nicht über die Seite', () => {
    expect(
      regelKoerper(".gefahren-print-root [data-lfh='gefahren-erlaeuterungen'] .listen-eintrag"),
    ).toMatch(/break-inside:\s*avoid/);
  });

  it('trägt keine Mechanik ein zweites Mal', () => {
    expect(css).not.toMatch(/visibility\s*:/);
    expect(css).not.toMatch(/position:\s*absolute/);
    expect(css).not.toContain('ant-table');
  });

  it('die Seite trägt die Druckwurzel, das Blatt und den Kopf', () => {
    const seite = readFileSync(join(HIER, 'GefahrenPage.tsx'), 'utf8');
    expect(seite).toMatch(/className="gefahren-print-root"\s+data-lfh="druckwurzel"/);
    expect(seite).toContain("import './gefahrenPrint.css';");
    expect(seite).toMatch(/<Druckkopf\s+dokumentart="Gefahrenbewertung"/);
  });
});
