import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * Zeichen der Sperre ohne Farbe (LLH-1233, Spec `textstufen-kontrast`): gesperrte antd-Knöpfe,
 * Felder und Einträge tragen einen GESTRICHELTEN Rand (`index.css`), ebenso das gesperrte Segment
 * der eigenen `Segmentleiste` (`theme/sprache.css`, LLH-1334). Damit das Zeichen eindeutig
 * bleibt, ist gestrichelt für Freies gesperrt: antds Knopfvariante `dashed` kommt im Quelltext
 * nicht vor.
 *
 * Gelesen wird Quelltext, kein Pixel; was der Browser wirklich zeichnet, misst
 * `e2e/gesperrt-kontrast.spec.ts`.
 *
 * ── BEKANNTE GRENZEN ──
 *
 * 1. Kommentare sind ausgenommen (`ohneKommentare`), Testdateien auch: dort steht die verbotene
 *    Form als Selbstbeweis.
 * 2. Gesucht wird die Variante als Prop (`type="dashed"`, `variant="dashed"`, auch in
 *    geschweiften Klammern) und als Objektschlüssel (`type: 'dashed'`). Eine aus einer Variablen
 *    gereichte Variante sieht der Guard nicht.
 * 3. Ein handgesetzter gestrichelter Rand (`1px dashed`, z. B. Kartenrahmen, Ablagefläche) ist
 *    kein Knopf und bleibt erlaubt.
 */

const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'index.css'))) return pfad;
  }
  throw new Error(`Gesperrt-Zeichen-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

const DASHED_VARIANTE = /\b(?:type|variant)\s*(?:=\s*\{?\s*|:\s*)['"]dashed['"]/;

/** Fundstellen der Variante `dashed` als `pfad:zeile  text`. Rein und exportiert. */
export function dashedBefunde(dateien: Record<string, string>): string[] {
  const befunde: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (/\.test\.[jt]sx?$/.test(pfad)) continue;
    ohneKommentare(inhalt).forEach((zeile, i) => {
      if (DASHED_VARIANTE.test(zeile)) befunde.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
    });
  }
  return befunde;
}

function lieseQuellen(verzeichnis: string, praefix = ''): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) Object.assign(treffer, lieseQuellen(pfad, rel));
    else if (/\.(ts|tsx)$/.test(eintrag.name)) treffer[rel] = readFileSync(pfad, 'utf8');
  }
  return treffer;
}

const QUELLEN = lieseQuellen(SRC);
const INDEX_CSS = ohneKommentare(readFileSync(join(SRC, 'index.css'), 'utf8')).join('\n');
const SPRACHE_CSS = ohneKommentare(readFileSync(join(SRC, 'theme', 'sprache.css'), 'utf8')).join(
  '\n',
);

/** Der Regelblock, der einen Selektor enthält, oder `undefined`. */
function regelZu(css: string, selektor: string): string | undefined {
  return css.split('}').find((block) =>
    block
      .split('{')[0]
      ?.split(',')
      .some((s) => s.trim() === selektor),
  );
}

describe('Gesperrtes trägt einen gestrichelten Rand (LLH-1233)', () => {
  it.each([
    ':root .ant-btn.ant-btn:disabled',
    ':root .ant-btn.ant-btn.ant-btn-disabled',
    ':root .ant-input.ant-input[disabled]',
    ':root .ant-input-affix-wrapper.ant-input-affix-wrapper-disabled',
    ':root .ant-input-number.ant-input-number-disabled',
    ':root .ant-picker.ant-picker-disabled',
    ':root .ant-select.ant-select-disabled',
    ':root .ant-radio-button-wrapper.ant-radio-button-wrapper-disabled',
  ])('%s', (selektor) => {
    const regel = regelZu(INDEX_CSS, selektor);
    expect(regel, `Kein Regelblock für ${selektor} in index.css`).toBeDefined();
    expect(regel).toMatch(/border-style:\s*dashed/);
    expect(regel).toMatch(/border-color:\s*var\(--lfh-steuer-rahmen\)/);
  });

  it.each([
    ':root .ant-menu-item.ant-menu-item-disabled',
    ':root .ant-dropdown-menu-item.ant-dropdown-menu-item-disabled',
    ':root .ant-select-item-option.ant-select-item-option-disabled',
  ])('%s (randloser Eintrag, Strichlinie nach innen)', (selektor) => {
    const regel = regelZu(INDEX_CSS, selektor);
    expect(regel, `Kein Regelblock für ${selektor} in index.css`).toBeDefined();
    expect(regel).toMatch(/outline:\s*1px dashed var\(--lfh-steuer-rahmen\)/);
  });

  // Die eigene Segmentleiste ersetzt antds `Segmented` und trägt dasselbe Zeichen (LLH-1334).
  it.each([".lfh-segment[aria-disabled='true']", ".lfh-segment[aria-disabled='true']:hover"])(
    '%s (sprache.css, Strichlinie nach innen)',
    (selektor) => {
      const regel = regelZu(SPRACHE_CSS, selektor);
      expect(regel, `Kein Regelblock für ${selektor} in theme/sprache.css`).toBeDefined();
      expect(regel).toMatch(/outline:\s*1px dashed var\(--lfh-steuer-rahmen\)/);
      expect(regel).toMatch(/outline-offset:\s*-1px/);
    },
  );

  it('ein freies Segment trägt keine Strichlinie (sprache.css)', () => {
    const regeln = SPRACHE_CSS.split('}').filter((block) =>
      (block.split('{')[0] ?? '')
        .split(',')
        .some((s) => /\.lfh-segment\b/.test(s) && !s.includes("[aria-disabled='true']")),
    );
    expect(regeln.length).toBeGreaterThan(0);
    for (const regel of regeln) expect(regel).not.toMatch(/dashed/);
  });
});

describe('Gestrichelt heißt gesperrt: keine freie Knopfvariante dashed (LLH-1233)', () => {
  it('kein Quelltext setzt type/variant dashed', () => {
    expect(
      dashedBefunde(QUELLEN),
      'Ein gestrichelter Rand ist das Zeichen der Sperre (index.css). Ein freier Knopf in der ' +
        'Variante dashed läse sich als gesperrt; nimm den Standardknopf.',
    ).toEqual([]);
  });

  it('Sentinel: der Korpus ist wirklich gelesen', () => {
    expect(Object.keys(QUELLEN).length).toBeGreaterThan(200);
  });

  it('Selbstbeweis: Prop- und Objektform werden gefunden, Kommentar und CSS-Rand nicht', () => {
    const baum = {
      'a.tsx': [
        '<Button type="dashed">Feld</Button>',
        "<Button variant={'dashed'} />",
        "const p = { type: 'dashed' };",
        '// <Button type="dashed"> im Kommentar',
        "const rand = { border: '1px dashed' };",
      ].join('\n'),
      'a.test.tsx': '<Button type="dashed" />',
    };
    expect(dashedBefunde(baum)).toEqual([
      'a.tsx:1  <Button type="dashed">Feld</Button>',
      "a.tsx:2  <Button variant={'dashed'} />",
      "a.tsx:3  const p = { type: 'dashed' };",
    ]);
  });
});
