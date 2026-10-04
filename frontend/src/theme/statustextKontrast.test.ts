import { theme } from 'antd';
import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import { antdAlgorithmus, antdToken, farbenDunkel, farbenHell, type Farbrollen } from './tokens';

/**
 * Warn- und Erfolgstext in der Textrolle des Status, GERECHNET statt behauptet (LFH-876, Spec
 * `textkontrast-rollen`).
 *
 * `Typography` vom Typ `warning`/`success` liest antds Map-Tokens `colorWarningText`/
 * `colorSuccessText`, nicht `colorWarning`/`colorSuccess`. Geprüft wird deshalb der von antd
 * AUFGELÖSTE Token mit dem echten Algorithmus je Modus: nachts leitet `darkAlgorithm` eigene Töne
 * ab, ein Blick auf `antdToken()` allein sähe das nicht. Böden als Literale; der
 * Browser-Nachweis steht in `e2e/statustext-kontrast.spec.ts`.
 */

/** Jede deckende Fläche, auf der Text stehen kann. */
const FLAECHEN = [
  'grund',
  'flaeche',
  'flaeche2',
  'paneel',
  'kopf',
  'flaeche3',
  'normalFlaeche',
  'achtungFlaeche',
  'alarmFlaeche',
  'bedienFlaeche',
] as const satisfies readonly (keyof Farbrollen)[];

describe.each([
  ['Tag', farbenHell, false, 7],
  ['Nacht', farbenDunkel, true, 5],
] as const)('Warn- und Erfolgstext — %s (LFH-876)', (_modus, farben, dunkel, boden) => {
  const t = theme.getDesignToken({ token: antdToken(farben), algorithm: antdAlgorithmus(dunkel) });

  it('Statustext trägt die Textrolle, kein abgeleiteter Ton', () => {
    expect(t.colorWarningText).toBe(farben.achtungText);
    expect(t.colorSuccessText).toBe(farben.normalText);
  });

  it('die Füllfarben bleiben die Statusrollen', () => {
    expect(t.colorWarning).toBe(farben.achtung);
    expect(t.colorSuccess).toBe(farben.normal);
  });

  it.each(FLAECHEN)('Warn- und Erfolgstext halten den Boden auf %s', (flaeche) => {
    expect(kontrast(t.colorWarningText, farben[flaeche])).toBeGreaterThanOrEqual(boden);
    expect(kontrast(t.colorSuccessText, farben[flaeche])).toBeGreaterThanOrEqual(boden);
  });
});
