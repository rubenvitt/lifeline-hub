import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Der Entwurfs-Ausdruck des Befehls (LFH-350, Befund M86) — Schwesterdatei zu
 * `lageberichtPrint.test.ts`, mit einem entscheidenden Unterschied: `BefehlDetailPage`
 * verdrahtet `layout="split"` fest und reiht die Abschnitte als schlichte
 * `Form.Item`-Liste ohne `Collapse`. Die Toggle- und die Akkordeon-Regel des
 * Lageberichts träfen hier nichts; die letzte Behauptung unten pinnt genau diese
 * Voraussetzung, damit die Lücke auffliegt, sobald jemand sie verschiebt.
 *
 * Geprüft wird die CSS-QUELLE (Bauform `LoginPage.animation.test.ts`): jsdom rechnet
 * kein Layout, lädt diese Datei nicht und kennt kein `@media print`.
 */
const DATEI = 'befehlPrint.css';
const SEITE = 'BefehlDetailPage.tsx';
const hier = dirname(fileURLToPath(import.meta.url));
const roh = readFileSync(join(hier, DATEI), 'utf8');
/** Kommentare tragen Klassennamen — sie färbten jede Selektor-Behauptung trivial grün. */
const css = roh.replace(/\/\*[\s\S]*?\*\//g, '');

/** Klammerbalancierte Grenzen des `@media print`-Blocks. */
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

interface Regel {
  selektor: string;
  koerper: string;
}

function regeln(): Regel[] {
  const [auf, zu] = grenzen();
  return [...css.slice(auf + 1, zu).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selektor: m[1].trim().replace(/\s+/g, ' '),
    koerper: m[2].trim().replace(/\s+/g, ' '),
  }));
}

function einzeln(regel: Regel): string[] {
  return regel.selektor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function versteckt(regel: Regel): boolean {
  return /display:\s*none/.test(regel.koerper);
}

describe('befehlPrint.css — Entwurfsausdruck (M86)', () => {
  it('haelt jede Regel im @media print — der Bildschirm bleibt unberuehrt', () => {
    expect(css.trim().startsWith('@media print')).toBe(true);
    expect(css.slice(grenzen()[1] + 1).trim()).toBe('');
  });

  it('scopt jede Regel auf den Druckbereich', () => {
    for (const r of regeln()) {
      for (const s of einzeln(r)) {
        expect(/^(body\b|\.befehl-)/.test(s), `ungescopter Selektor in ${DATEI}: ${s}`).toBe(true);
      }
    }
  });

  it('blendet die Eingabespalte des split-Layouts aus', () => {
    const treffer = regeln().filter(
      (r) =>
        r.selektor.includes('.markdown-editor--split') &&
        r.selektor.includes('.markdown-editor__eingabe') &&
        versteckt(r),
    );
    expect(treffer, 'keine Regel versteckt die Eingabespalte im split-Layout').toHaveLength(1);
    // Die Spalte selbst, nicht ihr Textfeld: der Wrapper trägt `flex: 1 1 50%`.
    expect(treffer[0].selektor.endsWith('.markdown-editor__eingabe')).toBe(true);
  });

  it('versteckt die Eingabe NIE unbedingt — sonst druckt ein Abschnitt leer', () => {
    for (const r of regeln().filter(versteckt)) {
      if (!/textarea|markdown-editor__eingabe/.test(r.selektor)) continue;
      expect(
        r.selektor.includes('.markdown-editor--split') ||
          r.selektor.includes(':has(.markdown-editor__vorschau)'),
        `unbedingte Eingabe-Ausblendung in ${DATEI}: ${r.selektor}`,
      ).toBe(true);
    }
    for (const r of regeln().filter(versteckt)) {
      for (const s of einzeln(r)) {
        expect(/\.markdown-editor(--\w+)?$/.test(s), `Editor ganz versteckt: ${s}`).toBe(false);
      }
    }
  });

  it('laesst Beschriftung und Vorschau-Umschalter des Editors weg', () => {
    const alle = regeln().filter(versteckt).flatMap(einzeln).join(' ');
    expect(alle).toContain('.markdown-editor__label');
    expect(alle).toContain('.markdown-editor .ant-btn');
  });

  it('behaelt die Bestandszusicherungen des Druckbereichs', () => {
    const bestand = regeln();
    expect(bestand.some((r) => r.selektor.includes('.befehl-no-print') && versteckt(r))).toBe(true);
  });

  it('pinnt die Voraussetzung: der Befehl kennt nur split und kein Akkordeon', () => {
    // Fällt diese Behauptung, fehlen dieser Datei die Toggle- und die
    // Akkordeon-Regel aus `lageberichtPrint.css`.
    const seite = readFileSync(join(hier, 'BefehlDetailPage.tsx'), 'utf8');
    // Als Muster, nicht als Zeichenkette: mit mehr Props bricht Prettier das Tag um.
    expect(seite).toMatch(/<MarkdownEditor\s+layout="split"/);
    // Als JSX-Prop bzw. Import gepinnt, nicht als Wort: ein Kommentar, der „toggle" oder
    // „Akkordeon" erwähnt, ändert am Layout nichts und darf nicht rot färben.
    expect(seite).not.toContain('layout="toggle"');
    expect(seite).not.toMatch(/import .*AbschnittsAkkordeon/);
  });
});

describe('befehlPrint.css — Seitenkopf', () => {
  it('blendet den Seitenkopf im Druck aus', () => {
    const regel = regeln().find((r) =>
      einzeln(r).includes(".befehl-print-root [data-lfh='seitenkopf']"),
    );
    expect(regel, 'Seitenkopf wird mitgedruckt').toBeDefined();
    expect(versteckt(regel!)).toBe(true);
  });
});

describe('befehlPrint.css — die Mechanik liegt in `druck/druck.css` (LFH-71)', () => {
  // Die GEGENAUSSAGE zum alten Muster: `body * { visibility: hidden }` plus ein absolut
  // positionierter Druckbereich druckte in Firefox und Safari nur die erste Seite, und jeder
  // unsichtbare Knoten belegte weiter Platz. Ausblenden, Fluss, Papierfarben und Umbruch
  // regelt jetzt EINE Datei für alle Druckstücke; eine zweite Fassung hier liefe still
  // auseinander.
  it('blendet nichts per visibility aus', () => {
    expect(css).not.toMatch(/visibility\s*:/);
  });

  it('nimmt den Druckbereich nicht aus dem Fluss', () => {
    expect(css).not.toMatch(/position:\s*absolute/);
  });

  it('setzt keine zweite Farbregel', () => {
    for (const r of regeln()) {
      expect(r.koerper, `Farbregel in befehlPrint.css: ${r.selektor}`).not.toMatch(
        /(^|;)\s*(color|background)\s*:/,
      );
    }
  });

  it('setzt keine zweite Umbruchregel', () => {
    expect(css).not.toMatch(/break-(after|before|inside)\s*:/);
  });

  it('setzt die Druckwurzel-Marke an `.befehl-print-root`', () => {
    const seite = readFileSync(join(dirname(fileURLToPath(import.meta.url)), SEITE), 'utf8');
    expect(seite).toMatch(/className="befehl-print-root"\s+data-lfh="druckwurzel"/);
  });
});
