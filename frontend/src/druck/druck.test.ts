import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die gemeinsame Druckmechanik (LFH-71, design.md D1/D3 des Changes `lfh-22-druck-export`).
 *
 * Geprüft wird die CSS-QUELLE, nicht ein gerechneter Stil — jsdom lädt keine CSS-Datei und
 * kennt kein `@media print` (Bauform von `pages/lageberichtPrint.test.ts`). Anders als dort
 * reicht hier kein flaches Regelmuster: `@page { @bottom-right { … } }` ist verschachtelt,
 * und ein flacher Parser läse den Randfeld-Block als Regel mit dem Selektor
 * `@page { margin: …; @bottom-right`. Der Parser unten baut deshalb einen Baum.
 *
 * Ob die Regeln im Browser WIRKEN, belegt `e2e/druck-fluss.spec.ts` — ein Selektor mit
 * Tippfehler steht auch da. Dieser Test sichert die Form: woran die Regeln hängen, was sie
 * NICHT tun (kein `visibility`), und dass das Randfeld keinen freien Text trägt.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const roh = readFileSync(join(HIER, 'druck.css'), 'utf8');
/** Kommentare tragen Selektorbruchstücke — sie würden jede Behauptung trivial grün färben. */
const css = roh.replace(/\/\*[\s\S]*?\*\//g, '');

const WURZEL = "[data-lfh='druckwurzel']";

interface Regel {
  /** Kette der umschließenden At-Regeln, außen zuerst (`['@media print', '@page']`). */
  kontext: string[];
  /** Selektor bzw. Kopf einer verschachtelten At-Regel ohne Block (`@bottom-right`). */
  selektor: string;
  /** Deklarationen, Whitespace normalisiert. */
  koerper: string;
}

/** Zerlegt CSS in Regeln mit ihrem At-Regel-Kontext. Versteht Verschachtelung. */
function zerlege(quelle: string, kontext: string[] = []): Regel[] {
  const regeln: Regel[] = [];
  let i = 0;
  let deklarationen = '';
  while (i < quelle.length) {
    const auf = quelle.indexOf('{', i);
    const zu = quelle.indexOf('}', i);
    if (auf < 0 || (zu >= 0 && zu < auf)) {
      deklarationen += quelle.slice(i);
      break;
    }
    // Alles bis zur öffnenden Klammer: vorangehende Deklarationen (bis zum letzten `;`)
    // und der Kopf des Blocks.
    const vorher = quelle.slice(i, auf);
    const schnitt = vorher.lastIndexOf(';');
    if (schnitt >= 0) deklarationen += vorher.slice(0, schnitt + 1);
    const kopf = vorher
      .slice(schnitt + 1)
      .trim()
      .replace(/\s+/g, ' ');
    let tiefe = 0;
    let ende = auf;
    for (; ende < quelle.length; ende++) {
      if (quelle[ende] === '{') tiefe++;
      else if (quelle[ende] === '}' && --tiefe === 0) break;
    }
    if (tiefe !== 0) throw new Error(`druck.css: unbalancierte Klammern nach „${kopf}"`);
    const innen = quelle.slice(auf + 1, ende);
    if (kopf.startsWith('@')) {
      const kinder = zerlege(innen, [...kontext, kopf]);
      regeln.push(...kinder);
      // Deklarationen direkt in der At-Regel (`@page { margin: … }`) als eigene Regel.
      const eigene = kinder.find((r) => r.selektor === '' && letztes(r.kontext) === kopf);
      if (!eigene && !/\{/.test(innen) && innen.trim()) {
        regeln.push({ kontext: [...kontext, kopf], selektor: '', koerper: norm(innen) });
      }
    } else {
      regeln.push({ kontext, selektor: kopf, koerper: norm(innen) });
    }
    i = ende + 1;
  }
  if (deklarationen.trim() && kontext.length > 0) {
    regeln.push({ kontext, selektor: '', koerper: norm(deklarationen) });
  }
  return regeln;
}

/** Letztes Element — `Array.prototype.at` liegt außerhalb von `lib: ES2020`. */
function letztes<T>(liste: T[]): T | undefined {
  return liste[liste.length - 1];
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** Einzelselektoren einer Gruppe — Kommas in Klammern (`:is(a, b)`) trennen nicht. */
function einzeln(selektor: string): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let start = 0;
  for (let i = 0; i < selektor.length; i++) {
    if (selektor[i] === '(') tiefe++;
    else if (selektor[i] === ')') tiefe--;
    else if (selektor[i] === ',' && tiefe === 0) {
      teile.push(selektor.slice(start, i).trim());
      start = i + 1;
    }
  }
  teile.push(selektor.slice(start).trim());
  // Prettier bricht lange Selektoren in Klammern um (`:not(\n  x\n)`) — der Umbruch ist
  // kein Teil des Selektors.
  return teile.map((t) => t.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')).filter(Boolean);
}

const regeln = zerlege(css);
const imDruck = (r: Regel) => r.kontext[0] === '@media print';
const druckRegeln = regeln.filter(
  (r) => imDruck(r) && !r.kontext.some((k) => k.startsWith('@page')),
);

function regelFuer(selektor: string): Regel | undefined {
  return druckRegeln.find((r) => einzeln(r.selektor).includes(selektor));
}

describe('druck.css — Aufbau', () => {
  it('der Parser findet überhaupt Regeln (Selbsttest gegen einen leeren Baum)', () => {
    expect(druckRegeln.length).toBeGreaterThan(5);
    expect(regeln.some((r) => r.kontext.includes('@bottom-right'))).toBe(true);
  });

  it('steht bis auf die Bildschirmregeln des Druckkopfs vollständig im @media print', () => {
    for (const r of regeln.filter((x) => !imDruck(x))) {
      for (const s of einzeln(r.selektor)) {
        expect(s.startsWith('.druckkopf'), `Regel außerhalb @media print: ${s}`).toBe(true);
      }
    }
  });

  it('bindet jede Druckregel an eine vorhandene Druckwurzel — ohne Wurzel druckt Strg+P wie bisher', () => {
    for (const r of druckRegeln) {
      for (const s of einzeln(r.selektor)) {
        expect(s.includes(WURZEL), `ungebundener Selektor: ${s}`).toBe(true);
      }
    }
  });

  it('fasst `visibility` nirgends an — unsichtbare Knoten belegen weiter Platz', () => {
    expect(css).not.toMatch(/visibility\s*:/);
  });

  it('wird global geladen', () => {
    const main = readFileSync(join(HIER, '..', 'main.tsx'), 'utf8');
    expect(main).toMatch(/import\s+'\.\/druck\/druck\.css';/);
  });
});

describe('druck.css — Mechanik (D1)', () => {
  it('blendet alles außer Wurzel, Vorfahren und Nachfahren per display: none aus', () => {
    const ausblenden = druckRegeln.filter((r) =>
      einzeln(r.selektor).some(
        (s) =>
          s.startsWith(`body:has(${WURZEL})`) &&
          s.includes(`:not(:has(${WURZEL}))`) &&
          s.includes(`:not(${WURZEL})`) &&
          s.includes(`:not(${WURZEL} *)`),
      ),
    );
    expect(ausblenden, 'keine Ausblende-Regel').toHaveLength(1);
    expect(ausblenden[0].koerper).toMatch(/display:\s*none\s*!important/);
  });

  it('neutralisiert die Vorfahren der Wurzel (Flex, 100vh, Polsterung, Bildlauf)', () => {
    const r = regelFuer(`:has(${WURZEL})`);
    expect(r, 'kein Vorfahren-Neutralisierer').toBeDefined();
    for (const erwartet of [
      /position:\s*static\s*!important/,
      /display:\s*block\s*!important/,
      /margin:\s*0\s*!important/,
      /padding:\s*0\s*!important/,
      /min-height:\s*0\s*!important/,
      /height:\s*auto\s*!important/,
      /overflow:\s*visible\s*!important/,
    ]) {
      expect(r!.koerper).toMatch(erwartet);
    }
  });

  it('stellt die Wurzel in den normalen Fluss', () => {
    const r = regelFuer(WURZEL);
    expect(r, 'keine Regel an der Wurzel').toBeDefined();
    expect(r!.koerper).toMatch(/position:\s*static\s*!important/);
    expect(css).not.toMatch(/position:\s*absolute/);
  });

  it('setzt Papierfarben im Druckbereich unbedingt', () => {
    const r = regelFuer(`${WURZEL} *`);
    expect(r, 'keine Farbregel').toBeDefined();
    expect(r!.koerper).toMatch(/color:\s*black\s*!important/);
    expect(r!.koerper).toMatch(/background:\s*transparent\s*!important/);
    expect(r!.koerper).toMatch(/box-shadow:\s*none\s*!important/);
  });
});

describe('druck.css — Umbruchregeln unter der Wurzel', () => {
  const mitDeklaration = (muster: RegExp) =>
    druckRegeln
      .filter((r) => muster.test(r.koerper))
      .flatMap((r) => einzeln(r.selektor))
      .join(' ');

  it('hält Überschriften bei ihrem Text (h1–h6)', () => {
    const sel = mitDeklaration(/break-after:\s*avoid/);
    for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(sel, `${h} fehlt`).toMatch(new RegExp(`\\b${h}\\b`));
    }
  });

  it('zerreißt Absätze, Listen, Zitate, Code, Zeilen, Bilder und Abbildungen nicht', () => {
    const sel = mitDeklaration(/break-inside:\s*avoid/);
    for (const el of ['p', 'ul', 'ol', 'blockquote', 'pre', 'tr', 'img', 'figure']) {
      expect(sel, `${el} fehlt`).toMatch(new RegExp(`\\b${el}\\b`));
    }
  });

  it('wiederholt Tabellenköpfe je Seite', () => {
    const r = regelFuer(`${WURZEL} thead`);
    expect(r, 'keine thead-Regel').toBeDefined();
    expect(r!.koerper).toMatch(/display:\s*table-header-group/);
  });

  it('schreibt break-* statt page-break-*', () => {
    expect(css).not.toMatch(/page-break-/);
  });
});

describe('druck.css — Seitenzählung (D3)', () => {
  const seite = regeln.filter((r) => r.kontext.some((k) => k.startsWith('@page')));

  it('setzt einen Seitenrand im @page', () => {
    const eigen = seite.find((r) => letztes(r.kontext) === '@page' && r.selektor === '');
    expect(eigen, '@page ohne Deklarationen').toBeDefined();
    expect(eigen!.koerper).toMatch(/margin:/);
  });

  it('zählt im Randfeld mit statischem Text und ohne freien Text', () => {
    const feld = seite.find((r) => letztes(r.kontext) === '@bottom-right');
    expect(feld, 'kein Randfeld @bottom-right').toBeDefined();
    const inhalt = /content:\s*([^;]+);?/.exec(feld!.koerper)?.[1].trim() ?? '';
    expect(inhalt).toContain('counter(page)');
    expect(inhalt).toContain('counter(pages)');
    // Nur feste Zeichenketten und Zähler. Eine `attr()`/`var()`-Quelle wäre freier Text
    // (Org-Name, Einsatz) in einem CSS-String — die Escape-Fläche, die D3 ausschließt.
    const rest = inhalt
      .replace(/counter\((page|pages)\)/g, '')
      .replace(/(["'])(Seite |\s*von\s*)\1/g, '')
      .trim();
    expect(rest, `freier Text im Randfeld: ${inhalt}`).toBe('');
  });
});
