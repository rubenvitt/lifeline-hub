import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import { antdKomponenten, farbenDunkel, farbenHell, type Farbrollen } from './tokens';

/**
 * Hinweisflächen (antds `Alert`), GERECHNET statt behauptet (WCAG-Formel).
 *
 * LFH-739, Spec `farbrollen-kontrast`: der Rand eines Steuerelements (`steuerRahmen`) hält auf
 * jeder Hinweisfläche ≥ 3 : 1 (WCAG 1.4.11), Text darauf den Textboden (Tag ≥ 7, Nacht ≥ 5). Die
 * Fläche ist die Statusflächen-Rolle ihrer Bedeutung und kommt aus dem KOMPONENTEN-Token: ein
 * vergessenes Token muss hier rot werden, nicht still auf antds trübe Ableitung fallen (am Tag
 * Info `#b9c1c4`, Rand darauf 2,16). Böden als Literale; gemessen in `e2e/hinweis-kontrast.spec.ts`.
 */
const RANDBODEN = 3;

/** Ein Komponenten-Token als Hex; fehlt es, ist das ein Befund, kein Rückfall auf antd. */
function token(quelle: object | undefined, name: string): string {
  const wert = (quelle as Record<string, unknown> | undefined)?.[name];
  if (typeof wert !== 'string') throw new Error(`Komponenten-Token ${name} fehlt`);
  return wert;
}

const HINWEISE = [
  ['Info', 'colorInfoBg', 'bedienFlaeche'],
  ['Warnung', 'colorWarningBg', 'achtungFlaeche'],
  ['Fehler', 'colorErrorBg', 'alarmFlaeche'],
  ['Erfolg', 'colorSuccessBg', 'normalFlaeche'],
] as const satisfies readonly (readonly [string, string, keyof Farbrollen])[];

describe.each([
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
] as const)('Hinweisflächen — %s (LFH-739)', (_modus, farben, textboden) => {
  const { Alert, Button } = antdKomponenten(farben, 'kompakt');

  describe.each(HINWEISE)('%s', (_typ, name, rolle) => {
    it(`trägt die Statusfläche ${rolle}`, () => {
      expect(token(Alert, name)).toBe(farben[rolle]);
    });

    it('Rand eines Steuerelements gegen die Hinweisfläche', () => {
      expect(kontrast(farben.steuerRahmen, token(Alert, name))).toBeGreaterThanOrEqual(RANDBODEN);
    });

    it.each(['text', 'gedaempft'] as const)('%s auf der Hinweisfläche', (stufe) => {
      expect(kontrast(farben[stufe], token(Alert, name))).toBeGreaterThanOrEqual(textboden);
    });
  });

  // Ein Gefahrknopf ohne Rahmen im Fehlerhinweis (Live-Banner) steht in Ruhe auf der Fehlerfläche.
  // Unter dem Zeiger zeichnet er antds GLOBALE Tönung `colorErrorBg`, nicht die des Hinweises: der
  // Override endet an der Wurzel des Knopfs, die die globalen Variablen neu setzt (design.md E2,
  // im Browser belegt). Dieses Paar rechnet `gefahrKontrast.test.ts`.
  it('Gefahrknopf ohne Rahmen im Fehlerhinweis: Beschriftung in Ruhe auf der Fehlerfläche', () => {
    expect(
      kontrast(token(Button, 'colorError'), token(Alert, 'colorErrorBg')),
    ).toBeGreaterThanOrEqual(textboden);
  });
});
