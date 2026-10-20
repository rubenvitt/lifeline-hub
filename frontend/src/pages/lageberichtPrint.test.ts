import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Druckregeln der Seite (`lageberichtPrint.css`). Den Entwurfsausdruck (LFH-350/M86: jeder Abschnitt genau
 * einmal; LFH-1008: Papiertitel im Titelblock) trägt seit LLH-1074 der Baustein der Schreibfläche
 * (`entwurf/dokumentEntwurf.css`, Test `entwurf/dokumentEntwurfCss.test.ts`); diese Datei hält
 * nur noch die Bedienung der Seite aus dem Druck.
 *
 * Geprüft wird die CSS-Quelle: jsdom lädt diese Datei nicht und kennt kein `@media print`.
 */
const DATEI = 'lageberichtPrint.css';
const SEITE = 'LageberichtDetailPage.tsx';
const roh = readFileSync(join(dirname(fileURLToPath(import.meta.url)), DATEI), 'utf8');
/**
 * Kommentare tragen Klassennamen und Selektorbruchstücke — sie färbten jede Selektor-Behauptung
 * trivial grün.
 */
const css = roh.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Klammerbalancierte Grenzen des `@media print`-Blocks: `[erste öffnende, zugehörige schließende]`.
 */
function grenzen(): [number, number] {
  const start = css.indexOf('@media print');
  expect(start, '@media print nicht gefunden').toBeGreaterThanOrEqual(0);
  const auf = css.indexOf('{', start);
  let tiefe = 0;
  for (let i = auf; i < css.length; i++) {
    if (css[i] === '{') tiefe++;
    else if (css[i] === '}') {
      tiefe--;
      if (tiefe === 0) return [auf, i];
    }
  }
  throw new Error(`${DATEI}: unbalancierte Klammern im @media print`);
}

/** Inhalt des `@media print`-Blocks. */
function druckBlock(): string {
  const [auf, zu] = grenzen();
  return css.slice(auf + 1, zu);
}

interface Regel {
  /** Selektorgruppe, Whitespace normalisiert. */
  selektor: string;
  koerper: string;
}

function regeln(): Regel[] {
  return [...druckBlock().matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selektor: m[1].trim().replace(/\s+/g, ' '),
    koerper: m[2].trim().replace(/\s+/g, ' '),
  }));
}

/** Einzelselektoren einer Gruppe (`a, b` → `['a','b']`) — `:has(a, b)` gibt es hier nicht. */
function einzeln(regel: Regel): string[] {
  return regel.selektor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function versteckt(regel: Regel): boolean {
  return /display:\s*none/.test(regel.koerper);
}

describe('lageberichtPrint.css — Bedienung aus dem Druck', () => {
  it('haelt jede Regel im @media print — der Bildschirm bleibt unberuehrt', () => {
    expect(css.trim().startsWith('@media print')).toBe(true);
    expect(css.slice(grenzen()[1] + 1).trim()).toBe('');
  });

  it('scopt jede Regel auf den Druckbereich', () => {
    for (const r of regeln()) {
      for (const s of einzeln(r)) {
        expect(/^\.lagebericht-/.test(s), `ungescopter Selektor in ${DATEI}: ${s}`).toBe(true);
      }
    }
  });

  it('nimmt die Bedienung aus dem Druck', () => {
    expect(regeln().some((r) => r.selektor.includes('.lagebericht-no-print') && versteckt(r))).toBe(
      true,
    );
  });

  /**
   * EINE Mechanik für den Entwurfsausdruck: die Seite schreibt über `DokumentEntwurf` und trägt
   * keine eigene Editor- oder Akkordeonregel. Eine zweite liefe still auseinander (vorher: Toggle-
   * und Akkordeonregeln hier, Split- und Etikettregeln beim Befehl).
   */
  it('überlässt den Entwurfsausdruck dem Baustein der Schreibfläche', () => {
    for (const r of regeln()) {
      expect(r.selektor, `Entwurfsregel in ${DATEI}`).not.toMatch(
        /markdown-editor|ant-collapse|ant-form-item/,
      );
    }
    for (const datei of ['LageberichtDetailPage.tsx', 'PressemitteilungDetailPage.tsx']) {
      const seite = readFileSync(join(dirname(fileURLToPath(import.meta.url)), datei), 'utf8');
      expect(seite, datei).toMatch(/<DokumentEntwurf\b/);
      expect(seite, datei).not.toMatch(/<MarkdownEditor\b/);
    }
  });
});

describe('lageberichtPrint.css — Seitenkopf', () => {
  it('blendet den Seitenkopf im Druck aus', () => {
    const regel = regeln().find((r) =>
      einzeln(r).includes(".lagebericht-print-root [data-lfh='seitenkopf']"),
    );
    expect(regel, 'Seitenkopf wird mitgedruckt').toBeDefined();
    expect(versteckt(regel!)).toBe(true);
  });
});

describe('lageberichtPrint.css — die Mechanik liegt in `druck/druck.css` (LFH-71)', () => {
  // Gegenaussage zum alten Muster: `body * { visibility: hidden }` plus absolut positionierter
  // Druckbereich druckte in Firefox und Safari nur die erste Seite. Die Mechanik steht in einer
  // Datei für alle Druckstücke; eine zweite Fassung hier liefe still auseinander.
  it('blendet nichts per visibility aus', () => {
    expect(css).not.toMatch(/visibility\s*:/);
  });

  it('nimmt den Druckbereich nicht aus dem Fluss', () => {
    expect(css).not.toMatch(/position:\s*absolute/);
  });

  it('setzt keine zweite Farbregel', () => {
    for (const r of regeln()) {
      expect(r.koerper, `Farbregel in lageberichtPrint.css: ${r.selektor}`).not.toMatch(
        /(^|;)\s*(color|background)\s*:/,
      );
    }
  });

  it('setzt keine zweite Umbruchregel', () => {
    expect(css).not.toMatch(/break-(after|before|inside)\s*:/);
  });

  it('setzt die Druckwurzel-Marke an `.lagebericht-print-root`', () => {
    const seite = readFileSync(join(dirname(fileURLToPath(import.meta.url)), SEITE), 'utf8');
    expect(seite).toMatch(/className="lagebericht-print-root"\s+data-lfh="druckwurzel"/);
  });
});
