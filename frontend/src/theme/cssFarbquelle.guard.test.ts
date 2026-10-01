import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * CSS-Farbquelle (LFH-698, Spec `css-farbquelle`): **kein Farbliteral in handgeschriebenem CSS
 * außer `theme/rollen.css`.** Farbe kommt dort über `var(--lfh-*)`. Gate 5 sucht nur nach
 * kopierten A0-Rollenwerten; ein frei erfundener Wert wie das alte Deeplink-Gelb (`#fffbe6`)
 * rutschte an ihm vorbei. Dieser Guard schließt die Lücke für CSS, TSX bleibt bei Gate 5.
 *
 * ── BEKANNTE GRENZEN (Teil des Vertrags) ──
 *
 * 1. Gezählt werden Hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) und `rgb()`/`rgba()`/`hsl()`/
 *    `hsla()`. Farbnamen (`white`, `black`) fallen nicht darunter: das Druckblatt
 *    (`druck/druck.css`) setzt Papierfarben bewusst so, und ein Namensscanner träfe
 *    `white-space`.
 * 2. Ein ID-Selektor aus lauter Hex-Zeichen (`#fab`) wäre ein Falsch-Positiv. Heute gibt es
 *    keinen; wer einen braucht, benennt ihn um.
 * 3. Kommentare sind ausgenommen (`ohneKommentare`, dieselbe Grenze wie Gate 5).
 * 4. Gelesen wird über `node:fs`, nicht `import.meta.glob(…?raw)`: Vitest liefert CSS dort leer.
 */

const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'theme', 'rollen.css'))) return pfad;
  }
  throw new Error(`CSS-Farbquelle-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

/** Die eine Rollenquelle für handgeschriebenes CSS. */
const ROLLENQUELLE = 'theme/rollen.css';

/**
 * SCHULDMENGE: Dateien, die beim Einführen des Guards noch Farbliterale tragen. Sie schrumpft
 * nur: ein Eintrag ohne Fund färbt den Guard rot und fällt im selben Commit wie der Fix.
 * Nachzug: Markdown-Renderer und -Editor auf Rollen ziehen (LFH-889).
 */
export const OFFEN: readonly string[] = [
  // Code-Grund und Rahmen des Markdown-Renderers, je Modus als `rgba()` über Schwarz/Weiß.
  'components/Markdown.css',
  // Rahmen und Fläche des Markdown-Editors, dieselbe Form.
  'components/MarkdownEditor.css',
];

const FARBLITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])|\b(?:rgba?|hsla?)\(/gi;

/** Alle Farbliterale einer CSS-Datei außerhalb von Kommentaren, als `Zeile: Literal`. */
export function farbliterale(inhalt: string): { zeile: number; literal: string }[] {
  const treffer: { zeile: number; literal: string }[] = [];
  ohneKommentare(inhalt).forEach((sichtbar, i) => {
    for (const m of sichtbar.matchAll(FARBLITERAL)) treffer.push({ zeile: i + 1, literal: m[0] });
  });
  return treffer;
}

/**
 * Befunde über eine Menge CSS-Dateien (Pfad relativ zu `src/` → Inhalt). Leer = in Ordnung.
 * Rein und exportiert, damit die Regeln an Texten prüfbar sind, ohne den Baum zu ändern.
 */
export function befunde(dateien: Record<string, string>, offen: readonly string[]): string[] {
  const meldungen: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (pfad === ROLLENQUELLE || offen.includes(pfad)) continue;
    for (const { zeile, literal } of farbliterale(inhalt)) {
      meldungen.push(`${pfad}:${zeile}  ${literal}`);
    }
  }
  for (const pfad of offen) {
    const inhalt = dateien[pfad];
    if (inhalt === undefined || farbliterale(inhalt).length === 0) {
      meldungen.push(
        `tote Schuld-Ausnahme: ${pfad} trägt kein Farbliteral mehr — Eintrag streichen`,
      );
    }
  }
  return meldungen;
}

function lieseCss(verzeichnis: string, praefix = ''): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) Object.assign(treffer, lieseCss(pfad, rel));
    else if (eintrag.name.endsWith('.css')) treffer[rel] = readFileSync(pfad, 'utf8');
  }
  return treffer;
}

const dateien = lieseCss(SRC);

describe('CSS-Farbquelle (LFH-698): Farbliterale nur in theme/rollen.css', () => {
  it('findet außerhalb der Rollenquelle und der Schuldmenge kein Farbliteral', () => {
    const verstoesse = befunde(dateien, OFFEN).filter((m) => !m.startsWith('tote Schuld'));
    expect(
      verstoesse,
      `Farbliterale in CSS gefunden — Farbe kommt über var(--lfh-*) aus ${ROLLENQUELLE}; ` +
        `fehlt die Rolle, gehört sie dort UND in theme/tokens.ts hin:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('die Schuldmenge schrumpft nur — jeder Eintrag ist noch belegt', () => {
    expect(befunde(dateien, OFFEN).filter((m) => m.startsWith('tote Schuld'))).toEqual([]);
  });

  it('sieht die CSS-Dateien wirklich — sonst ist der Guard eine Attrappe', () => {
    expect(dateien['index.css'] ?? '').not.toBe('');
    expect(farbliterale(dateien[ROLLENQUELLE] ?? '').length).toBeGreaterThan(20);
    expect(Object.keys(dateien).length).toBeGreaterThan(10);
  });

  describe('Regeln an Texten', () => {
    it('meldet Hex in jeder Länge, aber keine längeren Wörter', () => {
      expect(farbliterale('a { color: #fff; b: #ffff; c: #ffffff; d: #ffffff80; }')).toHaveLength(
        4,
      );
      expect(farbliterale('a { grid-area: #fffbe6x; }')).toEqual([]);
    });

    it('meldet rgb, rgba, hsl und hsla', () => {
      const css = 'a { a: rgb(0 0 0); b: rgba(0,0,0,.1); c: hsl(0 0% 0%); d: HSLA(0,0%,0%,1); }';
      expect(farbliterale(css).map((t) => t.literal.toLowerCase())).toEqual([
        'rgb(',
        'rgba(',
        'hsl(',
        'hsla(',
      ]);
    });

    it('lässt Rollen-Properties und Kommentare in Ruhe, auch im Block über Zeilen', () => {
      const css = [
        '/* früher #fffbe6',
        '   und rgba(0, 0, 0, 0.1) */',
        '.x { background: var(--lfh-bedien-flaeche); }',
      ].join('\n');
      expect(farbliterale(css)).toEqual([]);
    });

    it('meldet Pfad und Zeile', () => {
      expect(befunde({ 'a/b.css': '\n.x { color: #123456; }' }, [])).toEqual([
        'a/b.css:2  #123456',
      ]);
    });

    it('nimmt die Rollenquelle aus, sonst nichts', () => {
      expect(befunde({ [ROLLENQUELLE]: ':root { --a: #fff; }' }, [])).toEqual([]);
      expect(befunde({ 'theme/sprache.css': '.a { color: #fff; }' }, [])).toHaveLength(1);
    });

    it('eine neue Datei mit Literal ist rot, auch wenn die Schuldmenge andere führt', () => {
      const menge = { 'alt.css': '.a { color: #000; }', 'neu.css': '.b { color: #000; }' };
      expect(befunde(menge, ['alt.css'])).toEqual(['neu.css:1  #000']);
    });

    it('ein Schuldeintrag ohne Literal oder ohne Datei ist rot', () => {
      expect(befunde({ 'alt.css': '.a { color: var(--lfh-text); }' }, ['alt.css'])).toEqual([
        'tote Schuld-Ausnahme: alt.css trägt kein Farbliteral mehr — Eintrag streichen',
      ]);
      expect(befunde({}, ['weg.css'])).toHaveLength(1);
    });
  });
});
