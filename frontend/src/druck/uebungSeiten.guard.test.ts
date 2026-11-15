import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Übung auf jeder Druckseite (LLH-1725, Spec `druck-dokumente`, „Gemeinsamer Druckkopf“;
 * `druck/AGENTS.md`, „Übung im Druck“). `druck.css` legt die Wurzel einer Übung auf die benannte
 * Seite `uebung` mit Randfeld. Ein Blatt mit EIGENER benannter Seite (Anlage, Lageplan,
 * Fernmeldeskizze) überschreibt das für seine Seiten; ohne Variante stünde dort kein „ÜBUNG“.
 *
 * Geprüft an der CSS-Quelle (jsdom kennt kein `@media print`): jede benannte Seite `X` hat eine
 * Variante `X-uebung` mit demselben Format und dem Randfeld „ÜBUNG“, und eine Regel unter einer
 * Wurzel mit Übungskopf wählt sie, in `druck.css`. Ob das Randfeld gedruckt wird, belegt `e2e/etb-druck.spec.ts`.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const WURZEL_UEBUNG = "[data-lfh='druckwurzel']:has([data-lfh='druckkopf'][data-uebung])";

function cssDateien(verzeichnis: string): string[] {
  const aus: string[] = [];
  for (const name of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) aus.push(...cssDateien(pfad));
    else if (name.endsWith('.css')) aus.push(pfad);
  }
  return aus;
}

const QUELLEN = cssDateien(SRC).map((pfad) => ({
  datei: relative(SRC, pfad),
  css: readFileSync(pfad, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

/** Der Block hinter `kopf {` bis zur passenden Klammer. */
function block(css: string, kopf: string): string | undefined {
  const i = css.indexOf(`${kopf} {`);
  if (i < 0) return undefined;
  let tiefe = 0;
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') tiefe++;
    else if (css[j] === '}' && --tiefe === 0) return css.slice(css.indexOf('{', i) + 1, j);
  }
  return undefined;
}

const SEITEN = QUELLEN.flatMap(({ datei, css }) =>
  [...css.matchAll(/@page ([a-z0-9-]+) \{/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'uebung' && !name.endsWith('-uebung'))
    .map((name) => ({ datei, css, name })),
);

describe('Übung auf jeder benannten Druckseite (LLH-1725)', () => {
  it('findet die bekannten benannten Seiten (Selbsttest gegen eine leere Liste)', () => {
    expect(SEITEN.map((s) => s.name)).toEqual(
      expect.arrayContaining(['dokument-anlage', 'lageplan', 'fernmeldeskizze-a3']),
    );
  });

  it.each(SEITEN.map((s) => [s.name, s] as const))(
    '%s hat eine Variante mit Randfeld, gewählt unter einer Wurzel mit Übungskopf',
    (_name, { datei, css, name }) => {
      const variante = block(css, `@page ${name}-uebung`);
      expect(variante, `${datei}: @page ${name}-uebung fehlt`).toBeDefined();
      const format = block(css, `@page ${name}`)!.match(/size:[^;]+;/)?.[0];
      if (format) expect(variante).toContain(format);
      expect(block(variante!, '@top-center')).toMatch(/content: 'ÜBUNG';/);
      // Die Wahl der Variante ist Mechanik und steht in `druck/druck.css` (dort hängt jede Regel
      // an der Wurzel); die Datei des Blatts trägt nur das Format.
      expect(QUELLEN.find((q) => q.datei === 'druck/druck.css')!.css).toMatch(
        new RegExp(
          `${WURZEL_UEBUNG.replace(/[[\]().*+?^$|\\]/g, '\\$&')} [^{]+\\{\\s*page: ${name}-uebung;`,
        ),
      );
    },
  );
});
