/**
 * Die Kopf-Polsterung ist an beiden Kopfzeilen verdrahtet (LFH-329 · B1/M12). Ohne sie hängen
 * die Kopfzeilen am antd-Komponententoken, kompakt rund 47 px je Seite, auf 390 px ein Viertel
 * der Breite.
 *
 * Quelltext-Pin statt Komponententest: Vitest fährt mit `css: false`, jsdom rechnet kein Layout,
 * und cssstyle kann logische Kurzschreibweisen mit `var()` verwerfen. Die Wirkung belegt
 * `e2e/kopfzeile-schmal.spec.ts`. Gelesen wird per `node:fs`, weil `import.meta.glob(…?raw)`
 * für CSS den Leerstring liefert.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { theme } from 'antd';
import { describe, expect, it } from 'vitest';

const hier = dirname(fileURLToPath(import.meta.url));
const src = join(hier, '..');
const css = readFileSync(join(hier, 'rollen.css'), 'utf-8');
const lies = (relativ: string) => readFileSync(join(src, relativ), 'utf-8');

const APP_LAYOUT = 'components/AppLayout.tsx';
const EINSATZ_LAYOUT = 'einsatz/EinsatzLayout.tsx';

/** Die Property, um die es geht — als handgeschriebenes Literal, nicht als Konstante. */
const PROPERTY = '--lfh-kopf-polsterung';

/** Die Schwelle, ab der die Kopfzeile die volle Polsterung trägt: antds `lg`. Als Argument,
 *  weil die Datei einen zweiten Media-Block (Seitenrinne ab `md`) trägt. */
function medienblock(mindestbreite: number): Record<string, string> {
  const treffer = new RegExp(`^@media \\(min-width: ${mindestbreite}px\\)\\s*\\{`, 'm').exec(css);
  if (!treffer) throw new Error(`Kein @media-Block ab ${mindestbreite}px in rollen.css`);
  const auf = css.indexOf('{', treffer.index);
  const zu = css.indexOf('\n}', auf);
  const werte: Record<string, string> = {};
  for (const [, name, wert] of css.slice(auf + 1, zu).matchAll(/(--lfh-[\w-]+):\s*([^;]+);/g)) {
    werte[name] = wert.trim();
  }
  return werte;
}

/** `:root`-Block am Zeilenanfang, erster Treffer — derselbe Schnitt wie in
 *  `rollen.guard.test.ts`. */
function wurzelblock(): Record<string, string> {
  const treffer = /^:root\s*\{/m.exec(css)!;
  const auf = css.indexOf('{', treffer.index);
  const zu = css.indexOf('\n}', auf);
  const werte: Record<string, string> = {};
  for (const [, name, wert] of css.slice(auf + 1, zu).matchAll(/(--lfh-[\w-]+):\s*([^;]+);/g)) {
    werte[name] = wert.trim();
  }
  return werte;
}

describe('Kopf-Polsterung — die Verdrahtung (LFH-329 · B1/M12)', () => {
  it('mobil zuerst: `:root` trägt das schmale Maß', () => {
    // Ohne Media-Kontext gilt der sichere Wert, wie bei der Seitenrinne.
    expect(wurzelblock()[PROPERTY]).toBe('12px');
  });

  it('ab der lg-Schwelle trägt sie das volle Maß', () => {
    // antds `lg`, dieselbe Schwelle wie für Kopfzeilen-Umschalter und Navigationsrahmen. Die
    // Seitenrinne liegt tiefer (`md`): die Kopfzeile wird enger, bevor die Fläche es wird.
    const lg = theme.getDesignToken().screenLG;
    expect(lg).toBe(992);
    expect(medienblock(lg)[PROPERTY]).toBe('24px');
  });

  it('die Seitenrinne bleibt davon unberührt (zwei Achsen, zwei Schwellen)', () => {
    // Gegenprobe: der md-Block darf die Kopf-Property nicht tragen und der lg-Block nicht die
    // Rinne, sonst läse einer der Guards still den falschen Block.
    expect(medienblock(768)[PROPERTY]).toBeUndefined();
    expect(medienblock(992)['--lfh-seiten-polsterung']).toBeUndefined();
  });

  it('der Haupt-`:root`-Block wird vom neuen Media-Block nicht beschattet', () => {
    // `rollen.guard.test.ts` nimmt den ERSTEN `:root` am Zeilenanfang; ein zweiter davor ließe
    // dessen Wertvergleiche still gegen die falschen Werte laufen.
    expect(wurzelblock()['--lfh-grund']).toBe('#e9ebee');
    // `[ \t]`, nicht `\s`: das schlösse den Zeilenumbruch ein und träfe jeden Media-Block nach
    // einer Leerzeile.
    expect(css).not.toMatch(/^[ \t]+@media/m);
    // Genau zwei Deklarationen: eine unter `:root`, eine im Media-Block.
    expect(css.match(new RegExp(PROPERTY, 'g'))).toHaveLength(2);
  });

  it('beide Kopfzeilen lesen dieselbe Property — genau einmal je Datei', () => {
    // Gezählt statt auf einer Zeile gesucht, damit Prettier-Umbrüche nicht stören. Beide Layouts
    // sind Geschwister und müssen gemeinsam umgestellt werden.
    for (const datei of [APP_LAYOUT, EINSATZ_LAYOUT]) {
      const inhalt = lies(datei);
      expect(inhalt, `${datei}: hat überhaupt eine Kopfzeile`).toContain('<Header');
      const treffer = inhalt.match(new RegExp(`paddingInline: 'var\\(${PROPERTY}\\)'`, 'g'));
      expect(treffer ?? [], `${datei}: genau eine Kopfzeile liest die Polsterung`).toHaveLength(1);
    }
  });
});
