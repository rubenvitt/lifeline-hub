import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MATRIX_KLASSE } from './matrixGeometrie';

/**
 * Die Geometrie der Gefahrenmatrix steht als CSS (Container-Abfrage auf die Paneelbreite).
 * Geprüft wird die QUELLE — jsdom rechnet weder Layout noch `@container`. Muster:
 * `pages/LoginPage.animation.test.ts`.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'gefahrenmatrix.css'),
  'utf8',
);

/** Regelkörper des ersten Vorkommens eines Selektors ab `ab`. */
function regel(selektor: string, ab = 0): string {
  const start = css.indexOf(`${selektor} {`, ab);
  expect(start, `Regel ${selektor} fehlt`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

const px = (s: string) => Number(s.replace('px', ''));

describe('gefahrenmatrix.css', () => {
  it('die Matrix ist der Container, gegen den gemessen wird', () => {
    expect(regel(`.${MATRIX_KLASSE.wurzel}`)).toContain('container-type: inline-size');
  });

  it('breit: der Balkenboden trägt „niedrig" in Mono 10 je Segment', () => {
    const zeile = regel(`.${MATRIX_KLASSE.zeile}`);
    const boden = /minmax\((\d+)px, 1fr\)/.exec(zeile)?.[1];
    const luecke = /gap: (\d+)px/.exec(regel(`.${MATRIX_KLASSE.stufen}`))?.[1];
    expect(boden).toBeDefined();
    expect(luecke).toBe('2');
    const segment = (px(boden!) - 3 * px(luecke!)) / 4;
    // JetBrains Mono: 0,6 em × 10 px × 7 Zeichen = 42 px — als Literal.
    expect(segment).toBeGreaterThanOrEqual(42);
  });

  it('breit erst, wenn die Mindestbreite samt Lücken (bis 16 px, Handschuh) Platz hat', () => {
    const zeile = regel(`.${MATRIX_KLASSE.zeile}`);
    const spalten = /grid-template-columns: minmax\((\d+)px, \d+px\) minmax\((\d+)px, 1fr\) (\d+)px/
      .exec(zeile)!
      .slice(1)
      .map(Number);
    const schwelle = Number(/@container \(max-width: ([\d.]+)px\)/.exec(css)?.[1]);
    // `max-width: 331.98px` heißt: ab 332 px gilt die breite Zeile.
    expect(spalten.reduce((a, b) => a + b, 0) + 2 * 16).toBeLessThanOrEqual(Math.ceil(schwelle));
  });

  it('schmal: Balken UND Legendenraster laufen über die volle Breite', () => {
    const abfrage = css.indexOf('@container');
    expect(regel(`.${MATRIX_KLASSE.zeile} > .${MATRIX_KLASSE.stufen}`, abfrage)).toContain(
      'grid-column: 1 / -1',
    );
    expect(regel(`.${MATRIX_KLASSE.legende} > .${MATRIX_KLASSE.fueller}`, abfrage)).toContain(
      'display: none',
    );
  });
});
