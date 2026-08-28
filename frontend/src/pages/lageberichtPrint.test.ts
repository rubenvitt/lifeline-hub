import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Der Entwurfs-Ausdruck des Lageberichts (LFH-350, Befund M86).
 *
 * Im Status `entwurf` rendert `LageberichtDetailPage` je Abschnitt einen
 * `MarkdownEditor` INNERHALB von `.lagebericht-print-root`. Ohne Druckregeln kam der
 * Abschnitt im `split`-Layout doppelt aufs Papier (Roh-Markdown neben gerendertem
 * Text) — und, am 28.08.2026 mitgemessen, im Akkordeon überhaupt nur EINMAL: die
 * sieben zugeklappten Abschnitte stehen zwar per `forceRender` im DOM, sind aber
 * ausgeblendet.
 *
 * Geprüft wird die CSS-QUELLE, nicht ein gerechneter Stil — Bauform von
 * `LoginPage.animation.test.ts`: jsdom rechnet kein Layout, lädt diese Datei gar nicht
 * und kennt kein `@media print`. Der Text ist die Wahrheit, die im Browser ankommt.
 */
const DATEI = 'lageberichtPrint.css';
const roh = readFileSync(join(dirname(fileURLToPath(import.meta.url)), DATEI), 'utf8');
/** Kommentare tragen hier Klassennamen und Selektorbruchstücke — sie würden jede
 *  Selektor-Behauptung unten trivial grün färben. */
const css = roh.replace(/\/\*[\s\S]*?\*\//g, '');

/** Klammerbalancierte Grenzen des `@media print`-Blocks: `[erste geschweifte, zugehoerige schliessende]`. */
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
  return regel.selektor.split(',').map((s) => s.trim()).filter(Boolean);
}

function versteckt(regel: Regel): boolean {
  return /display:\s*none/.test(regel.koerper);
}

/** Regeln, deren Selektor auf die ROHE Eingabe zielt (Textfeld oder Eingabespalte). */
function eingabeRegeln(): Regel[] {
  return regeln().filter((r) => /textarea|markdown-editor__eingabe/.test(r.selektor));
}

describe('lageberichtPrint.css — Entwurfsausdruck (M86)', () => {
  it('haelt jede Regel im @media print — der Bildschirm bleibt unberuehrt', () => {
    // Die schärfere Hälfte: eine Regel, die aus dem Block herausrutscht, versteckt das
    // Eingabefeld auch beim Schreiben. Der Block umfasst die ganze Datei.
    expect(css.trim().startsWith('@media print')).toBe(true);
    expect(css.slice(grenzen()[1] + 1).trim()).toBe('');
  });

  it('scopt jede Regel auf den Druckbereich', () => {
    for (const r of regeln()) {
      for (const s of einzeln(r)) {
        expect(
          /^(body\b|\.lagebericht-)/.test(s),
          `ungescopter Selektor in ${DATEI}: ${s}`,
        ).toBe(true);
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
    // Die Gegenaussage zur Regel darüber, und die eigentliche Falle des Tickets: im
    // `toggle`-Layout (der VORGABE der Seite) ist das Textfeld nicht in
    // `.markdown-editor__eingabe` gewickelt und bei geschlossener Vorschau der einzige
    // Träger des Abschnittstextes. Jede versteckende Regel muss deshalb an einen
    // Beleg gebunden sein, dass eine gerenderte Vorschau danebensteht.
    for (const r of eingabeRegeln().filter(versteckt)) {
      expect(
        r.selektor.includes('.markdown-editor--split') ||
          r.selektor.includes(':has(.markdown-editor__vorschau)'),
        `unbedingte Eingabe-Ausblendung in ${DATEI}: ${r.selektor}`,
      ).toBe(true);
    }
    // Und der Editor wird nirgends als GANZES versteckt (das träfe die Vorschau mit).
    for (const r of regeln().filter(versteckt)) {
      for (const s of einzeln(r)) {
        expect(/\.markdown-editor(--\w+)?$/.test(s), `Editor ganz versteckt: ${s}`).toBe(false);
      }
    }
  });

  it('nimmt dem toggle-Layout das Textfeld nur bei offener Vorschau', () => {
    const treffer = regeln().filter(
      (r) => r.selektor.includes('.markdown-editor--toggle') && versteckt(r),
    );
    expect(treffer, 'keine Toggle-Regel — offene Vorschau druckt doppelt').toHaveLength(1);
    expect(treffer[0].selektor).toContain(':has(.markdown-editor__vorschau)');
    expect(treffer[0].selektor).toContain('textarea');
  });

  it('druckt auch die zugeklappten Akkordeon-Abschnitte', () => {
    // Gemessen am 28.08.2026: ein nie geöffneter Abschnitt trägt ein INLINE
    // `display:none` von rc-motion, ein wieder zugeklappter die Klasse
    // `ant-collapse-panel-hidden`; gemeinsam ist beiden `-panel-inactive`.
    const treffer = regeln().filter((r) => r.selektor.includes('.ant-collapse-panel-inactive'));
    expect(treffer, 'ohne diese Regel druckt der Entwurf einen von acht Abschnitten').toHaveLength(1);
    expect(treffer[0].koerper).toMatch(/display:\s*block/);
    // Ohne `!important` gewinnt der Inline-Stil des nie geöffneten Abschnitts.
    expect(treffer[0].koerper).toContain('!important');
  });

  it('laesst Beschriftung und Vorschau-Umschalter des Editors weg', () => {
    const chrome = regeln().filter(
      (r) => versteckt(r) && /markdown-editor__label|markdown-editor \.ant-btn/.test(r.selektor),
    );
    expect(chrome.length).toBeGreaterThan(0);
    const alle = chrome.flatMap(einzeln).join(' ');
    expect(alle).toContain('.markdown-editor__label');
    expect(alle).toContain('.markdown-editor .ant-btn');
  });

  it('behaelt die Bestandszusicherungen des Druckbereichs', () => {
    const bestand = regeln();
    expect(bestand.some((r) => r.selektor.includes('.lagebericht-no-print') && versteckt(r))).toBe(true);
    expect(bestand.some((r) => r.selektor.includes('.lagebericht-druck .markdown'))).toBe(true);
  });
});
