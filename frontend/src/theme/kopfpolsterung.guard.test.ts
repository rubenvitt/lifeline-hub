/**
 * Die Kopf-Polsterung ist verdrahtet — an beiden Kopfzeilen (LFH-329 · B1/M12).
 *
 * WARUM QUELLTEXT-PIN UND KEIN KOMPONENTENTEST: `vite.config.ts` fährt Vitest
 * mit `css: false`, und jsdom rechnet kein Layout — eine Media-Regel hat im
 * Unit-Lauf null Wirkung. Eine DOM-Behauptung auf `style.paddingInline` wäre
 * zusätzlich riskant, weil cssstyle logische Kurzschreibweisen mit `var()`
 * verwerfen kann: rot (oder grün) aus dem falschen Grund. Die WIRKUNG belegt
 * `e2e/kopfzeile-schmal.spec.ts` im Browser. Muster: `seitenrinne.guard.test.ts`.
 *
 * Gelesen wird per `node:fs`, NICHT per `import.meta.glob(…?raw)` — der liefert
 * für CSS unter Vitest den Leerstring.
 *
 * WAS HIER AUF DEM SPIEL STEHT: ohne eigene Polsterung hängen beide Kopfzeilen
 * am antd-Komponententoken. Der leitet sich aus der Steuerhöhe ab und beträgt
 * bei der kompakten Stufe rund 47 px je Seite — auf einem 390-px-Schirm knapp
 * ein Viertel der Breite, nur für Rand. Das bricht nichts und fällt erst im
 * Einsatz auf; genau dafür gibt es diesen Pin.
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

/** Die Schwelle, ab der die Kopfzeile die volle Polsterung trägt: antds `lg`.
 *  Bewusst als Argument und nicht als generisches `@media` — die Datei trägt
 *  bereits einen zweiten Media-Block (die Seitenrinne ab `md`), und ein Guard,
 *  der irgendeinen davon greift, ginge je nach Reihenfolge aus dem falschen
 *  Grund rot. */
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
    // Wer die Property ohne Media-Kontext liest, bekommt den sicheren Wert.
    // Dieselbe Richtung wie bei der Seitenrinne — zwei Achsen, ein Muster.
    expect(wurzelblock()[PROPERTY]).toBe('12px');
  });

  it('ab der lg-Schwelle trägt sie das volle Maß', () => {
    // Die Schwelle wird NICHT neu erfunden: sie ist antds `lg` — dieselbe, an
    // der die Kopfzeile ihre Umschalter ablegt und der Navigationsrahmen hinter
    // den Griff wandert. Die Seitenrinne liegt bewusst tiefer (`md`): die
    // Kopfzeile wird enger, bevor die Fläche es wird.
    const lg = theme.getDesignToken().screenLG;
    expect(lg).toBe(992);
    expect(medienblock(lg)[PROPERTY]).toBe('24px');
  });

  it('die Seitenrinne bleibt davon unberührt (zwei Achsen, zwei Schwellen)', () => {
    // Gegenprobe zum Schnitt oben: der md-Block darf die Kopf-Property NICHT
    // tragen und der lg-Block nicht die Rinne — sonst hätte einer der beiden
    // Guards still den falschen Block gelesen.
    expect(medienblock(768)[PROPERTY]).toBeUndefined();
    expect(medienblock(992)['--lfh-seiten-polsterung']).toBeUndefined();
  });

  it('der Haupt-`:root`-Block wird vom neuen Media-Block nicht beschattet', () => {
    // `rollen.guard.test.ts` ankert `:root` am Zeilenanfang und nimmt den ERSTEN
    // Treffer. Ein unindentierter oder zu weit oben stehender zweiter `:root`
    // ließe dort ~30 Wertvergleiche still gegen die falschen Werte laufen.
    expect(wurzelblock()['--lfh-grund']).toBe('#e7ebf0');
    // `[ \t]`, nicht `\s`: letzteres schlösse den Zeilenumbruch ein und träfe
    // damit JEDEN Media-Block, dem eine Leerzeile vorausgeht (gemessen).
    expect(css).not.toMatch(/^[ \t]+@media/m);
    // Genau zwei Deklarationen: eine unter `:root`, eine im Media-Block.
    expect(css.match(new RegExp(PROPERTY, 'g'))).toHaveLength(2);
  });

  it('beide Kopfzeilen lesen dieselbe Property — genau einmal je Datei', () => {
    // GEZÄHLT, nicht auf einer Zeile gesucht: der Stil des `<Header>` bricht je
    // nach Formatierung um, ein Zeilen-Filter wäre also an prettier gebunden.
    // Beide Layouts sind Geschwister — wer nur eines umstellt, lässt den
    // Handschirm auf der halben App auf dem Fükw-Maß stehen.
    for (const datei of [APP_LAYOUT, EINSATZ_LAYOUT]) {
      const inhalt = lies(datei);
      expect(inhalt, `${datei}: hat überhaupt eine Kopfzeile`).toContain('<Header');
      const treffer = inhalt.match(new RegExp(`paddingInline: 'var\\(${PROPERTY}\\)'`, 'g'));
      expect(treffer ?? [], `${datei}: genau eine Kopfzeile liest die Polsterung`).toHaveLength(1);
    }
  });
});
