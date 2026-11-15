import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * Größen nur aus der Skala (LLH-1775, Spec `schriftskala`, „Größen nur aus der Skala“; Change
 * `i1o47voj-schrift-lesbarkeit`, design.md Entscheidung 4).
 *
 * Eine Schriftgröße kommt im Frontend nur aus dem Theme: `schriftGroesse`, `schriftStil`,
 * `zahlStil` (`components/instrument/rollenwerte.ts`), der Baustein `Schrift`, antds
 * `token.fontSize*` oder `var(--lfh-typo-…)`/`var(--lfh-groesse-…)` in CSS. Vorher standen rund
 * 240 `fontSize`-Literale in 180 Dateien neben 31 Verweisen auf die Skala, gerendert wurden 14
 * Größen. Ein Literal wächst nicht mit der Dichte und kennt keinen Boden.
 *
 * KEINE SCHULDMENGE: der Bestand wurde vor dem Scharfschalten ganz umgestellt (Entscheidung
 * 15.11.2026). Ein Vitest-Wächter statt ESLint, weil `pnpm lint` mit `--max-warnings 0` rot
 * geboren wäre und ESLint kein CSS liest.
 *
 * ── WAS ER MELDET ──
 *
 * TS/TSX (ohne Tests, ohne `theme/`, ohne `test/`):
 * 1. `fontSize:`/`fontSize=` mit einer Zahl oder einer Längenangabe im Wert derselben Zeile.
 * 2. `font-size:` mit einer Zahl in einem String (HTML für Kartenpopups, CSS in JS) und
 *    `.font = '…12px…'` (Canvas).
 * 3. `monoStil(` — der Helfer heißt `zahlStil` und nimmt eine Stufe.
 * 4. Eine Mono-Familie als Literal (`monospace`): Mono kommt nur aus `schrift.zahl`.
 *
 * CSS (ohne `theme/rollen.css` und die Druckblätter, die auf Papier in pt rechnen):
 * 5. `font-size:` ohne `var(--lfh-typo-…)`, `var(--lfh-groesse-…)` oder `inherit`; `font:` mit
 *    einer Längenangabe.
 *
 * ── BEKANNTE GRENZEN ──
 *
 * Gelesen wird zeilenweise ohne Kommentare (`ohneKommentare`). Ein Wert über mehrere Zeilen wird
 * nur in seiner ersten Zeile geprüft; Prettier bricht kurze Werte nicht um. Der Lagemonitor
 * liest seine Fernsicht-Skala aus `theme/tokens.ts` (`fernsicht`), sie ist damit Theme.
 */

const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'theme', 'rollen.css'))) return pfad;
  }
  throw new Error(`Schrift-Literal-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

/** Die Dateien des Lagemonitors, die die Fernsicht-Skala (`fernsicht` im Theme) setzen. */
export const FERNSICHT_DATEIEN: readonly string[] = [
  'geraet/LagemonitorPage.tsx',
  'geraet/LagemonitorKarte.tsx',
];

/** Druckblätter: Papier, Größen in pt, Spec `schriftskala` nimmt sie aus. */
export const DRUCKBLAETTER: readonly string[] = [
  'druck/druck.css',
  'pages/lagekarte/lageplanDruck.css',
  'fernmeldewesen/skizze/skizzeDruck.css',
];

/** Eine Zahl, auch mit Einheit (`13`, `'13px'`, `0.9`), oder eine Einheit hinter `${…}`. */
const ZAHL = /(?<![\w.$-])\d+(?:\.\d+)?(?:px|pt|r?em|%)?(?![\w])|\}(?:px|pt|r?em)\b/;

/** Befunde einer TS/TSX-Datei als `Zeile: Grund`. */
export function tsBefunde(
  inhalt: string,
  fernsichtDatei = false,
): { zeile: number; grund: string }[] {
  const treffer: { zeile: number; grund: string }[] = [];
  ohneKommentare(inhalt).forEach((sichtbar, i) => {
    const zeile = i + 1;
    const groesse = /\bfontSize\s*[:=]\s*(.*)$/.exec(sichtbar);
    if (groesse) {
      // Bis zum Ende des Werts: das erste Komma oder `}` auf Klammertiefe 0.
      let tiefe = 0;
      let wert = '';
      for (const z of groesse[1]) {
        if ('([{'.includes(z)) tiefe += 1;
        if (')]}'.includes(z)) {
          if (tiefe === 0) break;
          tiefe -= 1;
        }
        if (z === ',' && tiefe === 0) break;
        wert += z;
      }
      // Die Fernsicht-Skala des Lagemonitors ist eine benannte Ausnahme (Spec `schriftskala`):
      // dort darf ein Wert aus `fernsicht` als `${…}px` stehen, eine Zahl aber nicht.
      const nurEinheit = fernsichtDatei && !/\d/.test(wert.replace(/\}px/g, ''));
      if (ZAHL.test(wert) && !nurEinheit) {
        treffer.push({ zeile, grund: `fontSize mit Zahl: ${wert.trim()}` });
      }
    }
    if (/font-size\s*:\s*[^;'"`]*\d/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'font-size mit Zahl im String' });
    }
    if (/\.font\s*=\s*['"`][^'"`]*\d+(?:\.\d+)?px/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'Canvas-Schrift mit Pixelzahl' });
    }
    if (/\bmonoStil\s*\(/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'monoStil: zahlStil(stufe) nehmen' });
    }
    if (/['"`][^'"`]*\bmonospace\b/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'Mono-Familie als Literal: schrift.zahl nehmen' });
    }
  });
  return treffer;
}

/**
 * Erlaubt: eine Variable der Skala, `inherit`, eine eigene Variable mit einer Stufe als Rückfall
 * (`var(--etb-inhalt-groesse, var(--lfh-groesse-text))`) und `pt`: Punkte gibt es nur auf Papier
 * (`@page`-Ränder, Druckköpfe).
 */
const CSS_ERLAUBT =
  /^\s*(?:var\(--lfh-(?:typo-[\w-]+-groesse|groesse-[\w-]+)\)|var\(--[\w-]+,\s*var\(--lfh-groesse-[\w-]+\)\)|inherit|\d+(?:\.\d+)?pt)\s*(?:!important\s*)?$/;

/** Befunde einer CSS-Datei als `Zeile: Grund`. */
export function cssBefunde(inhalt: string): { zeile: number; grund: string }[] {
  const treffer: { zeile: number; grund: string }[] = [];
  ohneKommentare(inhalt).forEach((sichtbar, i) => {
    const groesse = /(?:^|[\s;{])font-size\s*:\s*([^;}]*)/.exec(sichtbar);
    if (groesse && !CSS_ERLAUBT.test(groesse[1])) {
      treffer.push({ zeile: i + 1, grund: `font-size: ${groesse[1].trim()}` });
    }
    const kurz = /(?:^|[\s;{])font\s*:\s*([^;}]*)/.exec(sichtbar);
    if (kurz && /\d(?:\.\d+)?(?:px|pt|em|rem|%)/.test(kurz[1])) {
      treffer.push({ zeile: i + 1, grund: `font: ${kurz[1].trim()}` });
    }
  });
  return treffer;
}

function liesBaum(verzeichnis: string, praefix = ''): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const relativ = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    const voll = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) Object.assign(treffer, liesBaum(voll, relativ));
    else if (/\.(tsx?|css)$/.test(eintrag.name)) treffer[relativ] = readFileSync(voll, 'utf8');
  }
  return treffer;
}

/** Alle Befunde über eine Menge Dateien (Pfad relativ zu `src/` → Inhalt). Leer = in Ordnung. */
export function befunde(dateien: Record<string, string>): string[] {
  const meldungen: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (pfad.endsWith('.css')) {
      if (pfad === 'theme/rollen.css' || DRUCKBLAETTER.includes(pfad)) continue;
      for (const b of cssBefunde(inhalt)) meldungen.push(`${pfad}:${b.zeile}  ${b.grund}`);
      continue;
    }
    if (/\.test\.tsx?$/.test(pfad) || /^(theme|test)\//.test(pfad) || pfad.endsWith('.d.ts')) {
      continue;
    }
    for (const b of tsBefunde(inhalt, FERNSICHT_DATEIEN.includes(pfad))) {
      meldungen.push(`${pfad}:${b.zeile}  ${b.grund}`);
    }
  }
  return meldungen;
}

describe('Schriftgrößen nur aus der Skala (LLH-1775)', () => {
  it('kein Größen-Literal und keine freie Mono-Familie im Frontend', () => {
    expect(befunde(liesBaum(SRC))).toEqual([]);
  });

  it('die Druckblätter gibt es noch (sonst ist die Ausnahme tot)', () => {
    for (const pfad of [...DRUCKBLAETTER, ...FERNSICHT_DATEIEN]) {
      expect(existsSync(join(SRC, pfad)), pfad).toBe(true);
    }
  });
});

describe('Regeln des Wächters an Texten (Mutationsproben)', () => {
  it('meldet Zahlen und Längen im fontSize-Wert', () => {
    for (const zeile of [
      'style={{ fontSize: 12 }}',
      "style={{ fontSize: '13px' }}",
      'fontSize: leise ? schriftGroesse("klein") : 13,',
      '<text fontSize={10}>',
      'fontSize: token.fontSize * 0.9,',
      'fontSize: `${groesse}px`,',
    ]) {
      expect(tsBefunde(zeile), zeile).not.toEqual([]);
    }
  });

  it('lässt Stufen, Rollen und antd-Token durch', () => {
    for (const zeile of [
      "style={{ fontSize: schriftGroesse('klein'), fontWeight: 600 }}",
      'fontSize: token.fontSizeSM,',
      'fontSize: fernsicht.text,',
      "...zahlStil('fein', 500),",
    ]) {
      expect(tsBefunde(zeile), zeile).toEqual([]);
    }
  });

  it('Fernsicht: `${…}px` nur in den Lagemonitor-Dateien, eine Zahl nie', () => {
    expect(tsBefunde('fontSize: `${schrift}px`,', true)).toEqual([]);
    expect(tsBefunde('fontSize: `${schrift}px`,')).not.toEqual([]);
    expect(tsBefunde('fontSize: 28,', true)).not.toEqual([]);
  });

  it('meldet monoStil, Mono-Literale, font-size in Strings und Canvas', () => {
    expect(tsBefunde('...monoStil(11),')).not.toEqual([]);
    expect(tsBefunde("fontFamily: 'monospace',")).not.toEqual([]);
    expect(tsBefunde('html: \'<span style="font-size:11px">\'')).not.toEqual([]);
    expect(tsBefunde("ctx.font = '600 12px Archivo';")).not.toEqual([]);
  });

  it('CSS: nur Variablen der Skala oder inherit', () => {
    expect(cssBefunde('.a { font-size: 12px; }')).not.toEqual([]);
    expect(cssBefunde('.a { font-size: 0.9em; }')).not.toEqual([]);
    expect(cssBefunde('.a { font: 600 12px/1.2 sans-serif; }')).not.toEqual([]);
    expect(cssBefunde('.a { font-size: var(--lfh-typo-meta-groesse); }')).toEqual([]);
    expect(cssBefunde('.a { font-size: var(--lfh-groesse-klein); }')).toEqual([]);
    expect(cssBefunde('.a { font: inherit; font-size: inherit; }')).toEqual([]);
    expect(cssBefunde('.a { font-size: var(--x, var(--lfh-groesse-text)); }')).toEqual([]);
    expect(cssBefunde('.a { font-size: var(--x, 14px); }')).not.toEqual([]);
    expect(cssBefunde('@top-center { font-size: 11pt; }')).toEqual([]);
  });
});
