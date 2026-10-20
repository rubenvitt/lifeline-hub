/**
 * Die Ausgabe des Design Systems als Dateien (Change `uzfj5f43-design-system-aus-code`): Liste auf
 * der Platte, Schriftregeln der Vorschauen und die Prüfungen, die der Byte-Vergleich des Wächters
 * nicht leistet — auch eine falsche Ausgabe ist deterministisch (`checkOutput`).
 *
 * Rein bis auf `listFiles`, damit die Grenzfälle ohne Render prüfbar sind
 * (`src/designSystem.test.ts`).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Pfad relativ zu `project/` → Inhalt. */
export type OutputFiles = ReadonlyMap<string, string | Uint8Array>;

/** Ein Schnitt in `tokens.json` `type.fonts`. */
export interface FontEntry {
  family: string;
  /** Relativ zu `project/`, also `fonts/<datei>`. */
  file: string;
  weight: string;
}

/**
 * Die Grenzen des Artifact-Typs „Design System“ (SKILL.md des Typs, „Caps“): eine Datei höchstens
 * 15 MiB, ein System höchstens 1.008 Dateien und 256 MiB. Der Index `design-system.json` zählt mit;
 * ihn schreibt erst das Veröffentlichen. Die Grenze eines Aufrufs (16 MiB) betrifft das Senden,
 * nicht die Ausgabe: es geht in mehreren Aufrufen.
 */
export const LIMITS = { fileBytes: 15 * 2 ** 20, files: 1008, totalBytes: 256 * 2 ** 20 };

/**
 * Alle Dateien unter `dir`, relativ und mit `/`, sortiert. Punktdateien und -ordner
 * (`.DS_Store`, `._…` von macOS) fehlen: das Format verbietet sie, und der Wächter meldete sie
 * sonst lokal als überzählig.
 */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .filter((path) => !path.split('/').some((part) => part.startsWith('.')))
    .sort();
}

const byteLength = (content: string | Uint8Array) =>
  typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength;

export function checkLimits(files: OutputFiles): string[] {
  const findings: string[] = [];
  let total = 0;
  for (const [path, content] of files) {
    const bytes = byteLength(content);
    total += bytes;
    if (bytes >= LIMITS.fileBytes) {
      findings.push(`${path}: ${bytes} Bytes, höchstens ${LIMITS.fileBytes - 1}`);
    }
  }
  if (files.size + 1 > LIMITS.files) {
    findings.push(`${files.size} Dateien und der Index, höchstens ${LIMITS.files}`);
  }
  if (total > LIMITS.totalBytes) {
    findings.push(`${total} Bytes gesamt, höchstens ${LIMITS.totalBytes}`);
  }
  return findings;
}

/** Der Stilblock mit antds CSS in einer Vorschau (`generate.tsx`, `previewDocument`). */
export const ANTD_STYLE = '<style data-quelle="antd">';

/** Die Marke, die `extractStyle` auch bei leerem Cache schreibt. */
const CACHE_PATH_RULE = /\.data-ant-cssinjs-cache-path\{content:"[^"]*";\}/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Eine Vorschau trägt antds CSS, und jede Klasse `css-var-<schlüssel>` im Markup hat ihren Block
 * mit den Variablen des Themes. Ohne beides stünden Knöpfe und Felder im Browser-Standardstil da.
 */
export function checkPreviewCss(path: string, doc: string): string[] {
  const start = doc.indexOf(ANTD_STYLE);
  const end = doc.indexOf('</style>', start);
  const antdCss = start < 0 || end < 0 ? '' : doc.slice(start + ANTD_STYLE.length, end);
  if (antdCss.replace(CACHE_PATH_RULE, '').trim() === '') return [`${path}: antd-CSS fehlt`];
  const keys = new Set<string>();
  for (const [, classes] of doc.matchAll(/class="([^"]*)"/g)) {
    for (const name of classes.split(/\s+/)) {
      if (name.startsWith('css-var-')) keys.add(name);
    }
  }
  return [...keys]
    .sort()
    .filter((name) => !new RegExp(`\\.${escapeRegExp(name)}(?![\\w-])`).test(antdCss))
    .map((name) => `${path}: kein CSS für .${name}`);
}

/**
 * `@font-face` je Schnitt, die Datei relativ zu `components/<Name>/preview.html`. Im Artifact lädt
 * die Seite die Schriften ohnehin vor; so steht eine Vorschau auch für sich allein in der
 * Hausschrift. `swap` wie in der App (`theme/schriften.ts`).
 */
export function fontFaceCss(fonts: readonly FontEntry[]): string {
  return fonts
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';src:url('../../${f.file}') format('woff2');` +
        `font-weight:${f.weight};font-style:normal;font-display:swap}`,
    )
    .join('\n');
}

export function checkFonts(path: string, doc: string, fonts: readonly FontEntry[]): string[] {
  return fonts
    .filter((f) => !doc.includes(fontFaceCss([f])))
    .map((f) => `${path}: keine Schrift ${f.family} ${f.weight}`);
}

/**
 * Das Format nimmt den ersten Satz von `components/<Name>/README.md` als Zusammenfassung ins
 * Manifest: er beschreibt den Baustein, nicht seine Herkunft und keinen Spiegelstrich.
 */
export function checkComponentReadme(path: string, text: string): string[] {
  const first = text
    .split('\n')
    .find((line) => line.trim() !== '' && !line.startsWith('# '))
    ?.trim();
  return !first || /^(?:Quelle:|[-*] )/.test(first)
    ? [`${path}: erster Satz ist keine Zusammenfassung`]
    : [];
}

const asText = (content: string | Uint8Array) =>
  typeof content === 'string' ? content : Buffer.from(content).toString('utf8');

/** Alle Prüfungen über die ganze Ausgabe, je Befund eine Zeile. */
export function checkOutput(files: OutputFiles): string[] {
  const tokens = files.get('tokens.json');
  const fonts: FontEntry[] = tokens ? JSON.parse(asText(tokens)).type.fonts : [];
  const findings: string[] = [];
  for (const [path, content] of files) {
    if (!/^components\/[^/]+\//.test(path)) continue;
    if (path.endsWith('/preview.html')) {
      const doc = asText(content);
      findings.push(...checkFonts(path, doc, fonts));
      if (path !== 'components/Cover/preview.html') findings.push(...checkPreviewCss(path, doc));
    } else if (path.endsWith('/README.md')) {
      findings.push(...checkComponentReadme(path, asText(content)));
    }
  }
  return [...findings, ...checkLimits(files)];
}
