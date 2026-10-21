import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Druck- und Schirmregeln des Bausteins `DokumentEntwurf` (`dokumentEntwurf.css`, LLH-1074).
 *
 * Geprüft wird die CSS-Quelle: jsdom lädt die Datei nicht und kennt kein `@media print`. Am
 * gerenderten Blatt belegt es `e2e/druck-fluss.spec.ts` (acht Abschnitte je genau einmal, ohne
 * Rohtext, nicht abgeschnitten — im Bearbeiten und in der Lesefassung).
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const roh = readFileSync(join(HIER, 'dokumentEntwurf.css'), 'utf8');
const baustein = readFileSync(join(HIER, 'DokumentEntwurf.tsx'), 'utf8');
/** Kommentare tragen Selektorbruchstücke — sie färbten jede Behauptung trivial grün. */
const css = roh.replace(/\/\*[\s\S]*?\*\//g, '');

/** Inhalt des ersten `@media`-Blocks, dessen Bedingung `bedingung` enthält. */
function block(bedingung: string): string {
  const start = css.indexOf(`@media ${bedingung}`);
  expect(start, `@media ${bedingung} nicht gefunden`).toBeGreaterThanOrEqual(0);
  const auf = css.indexOf('{', start);
  let tiefe = 0;
  for (let i = auf; i < css.length; i++) {
    if (css[i] === '{') tiefe++;
    else if (css[i] === '}') {
      tiefe--;
      if (tiefe === 0) return css.slice(auf + 1, i);
    }
  }
  throw new Error('unbalancierte Klammern');
}

interface Regel {
  selektor: string;
  koerper: string;
}

function regeln(text: string): Regel[] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selektor: m[1].trim().replace(/\s+/g, ' '),
    koerper: m[2].trim().replace(/\s+/g, ' '),
  }));
}

const druck = regeln(block('print'));
const versteckt = (r: Regel) => /display:\s*none\s*!important/.test(r.koerper);

describe('dokumentEntwurf.css — Druck', () => {
  it('scopt jede Druckregel auf den Baustein', () => {
    expect(druck.length).toBeGreaterThan(0);
    for (const r of druck) {
      expect(r.selektor.startsWith("[data-lfh='dokument-entwurf']"), r.selektor).toBe(true);
    }
  });

  it('nimmt dem Editor das Textfeld und zeigt Druckfassung und Papiertitel (M86, LFH-1008)', () => {
    const textfeld = druck.filter(
      (r) => r.selektor.includes('.markdown-editor textarea') && versteckt(r),
    );
    expect(textfeld, 'Rohtext in Schirmhöhe käme aufs Papier').toHaveLength(1);
    const sichtbar = druck.find(
      (r) => r.selektor.includes('.markdown-editor__druck') && r.selektor.includes('__titel'),
    );
    expect(sichtbar, 'Druckfassung oder Titel bleiben am Papier verborgen').toBeDefined();
    expect(sichtbar!.koerper).toMatch(/display:\s*block\s*!important/);
    // Ohne `druckfassung` druckte ein Abschnitt leer, ohne `druckTitel` ohne Namen.
    expect(baustein).toMatch(/<MarkdownEditor\b[^>]*?\bdruckfassung\b/);
    expect(baustein).toMatch(/druckTitel=\{a\.label\}/);
    // Und der Editor wird nie als GANZES versteckt (das träfe die Druckfassung mit).
    for (const r of druck.filter(versteckt)) {
      expect(/\.markdown-editor$/.test(r.selektor), r.selektor).toBe(false);
    }
  });

  it('lässt die Bedienung weg: Gliederung, Kopfblock, Abschnittsköpfe, Paneelkopf', () => {
    const weg = druck.filter(versteckt).map((r) => r.selektor);
    const alle = weg.join(' ');
    for (const marke of ['gliederung', 'gliederung-kopf', 'entwurf-kopf', 'abschnitt-kopf']) {
      expect(alle, marke).toContain(`[data-lfh='${marke}']`);
    }
    expect(weg).toContain("[data-lfh='dokument-entwurf'] > [data-lfh='paneel'] > :first-child");
    // Die Marken stehen im Baustein (sonst träfe die Regel nichts).
    for (const marke of [
      'gliederung',
      'gliederung-kopf',
      'entwurf-kopf',
      'abschnitt-kopf',
      'dokument-entwurf',
    ]) {
      expect(baustein).toContain(`data-lfh="${marke}"`);
    }
  });

  it('überlässt Mechanik, Farbe und Umbruch `druck/druck.css` (LFH-71)', () => {
    expect(css).not.toMatch(/visibility\s*:/);
    expect(css).not.toMatch(/position:\s*absolute/);
    expect(css).not.toMatch(/break-(after|before|inside)\s*:/);
    for (const r of regeln(css)) {
      expect(r.koerper, r.selektor).not.toMatch(/(^|;)\s*(color|background)\s*:/);
    }
  });
});

describe('dokumentEntwurf.css — Schirm', () => {
  it('rollt die Gliederung unter `xl` in sich, statt die Seite quer laufen zu lassen', () => {
    const liste = regeln(css).find((r) => r.selektor === '.dokument-entwurf__gliederungsliste');
    expect(liste?.koerper).toMatch(/flex-wrap:\s*nowrap/);
    expect(liste?.koerper).toMatch(/overflow-x:\s*auto/);
  });

  it('klebt die Gliederung erst ab `xl` und dann unter dem Rahmen', () => {
    const xl = regeln(block('screen and (min-width: 1200px)'));
    const gliederung = xl.find((r) => r.selektor === '.dokument-entwurf__gliederung');
    expect(gliederung?.koerper).toMatch(/position:\s*sticky/);
    expect(gliederung?.koerper).toMatch(/top:\s*var\(--lfh-rahmen-oben/);
    // Außerhalb von `xl` klebt nichts.
    const ausserhalb = css.replace(block('screen and (min-width: 1200px)'), '');
    expect(ausserhalb).not.toMatch(/sticky/);
  });
});
