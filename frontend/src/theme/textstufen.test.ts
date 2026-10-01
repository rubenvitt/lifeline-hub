import { describe, expect, it } from 'vitest';
import { kontrast, lab } from '../test/farbmass';
import { farbenDunkel, farbenHell, type Farbrollen } from './tokens';

/**
 * Wächter der Textstufen (LFH-643, Spec `textstufen-kontrast`), gerechnet statt behauptet.
 *
 * JEDE Textstufe hält auf JEDER deckenden Fläche ihres Modus den Textboden: Tag ≥ 7 : 1,
 * Nacht ≥ 5 : 1 — auch der Tertiärtext `schwach` (Augenbraue, Meta, Platzhalter).
 * Unter dem Boden liegt nur Gesperrtes im Rahmen (`rahmenKontrast.test.ts`).
 *
 * Die Rangfolge bleibt sichtbar: benachbarte Stufen liegen ≥ 5 ΔL* auseinander. Das
 * Kontrastverhältnis zweier Grautöne überzeichnet auf hellem Grund; L* ist annähernd
 * wahrnehmungsgleich.
 *
 * Böden und Flächen als Literale: eine neue deckende Fläche kommt bewusst hierher. Die
 * durchscheinenden Füllungen (`*Fuellung`) sind keine Textgründe; Text darauf misst das
 * Browser-Gate der Seite.
 */

const BODEN = { hell: 7, dunkel: 5 } as const;
const STUFENABSTAND = 5;

const STUFEN = ['text', 'text2', 'gedaempft', 'schwach'] as const;

const DECKENDE_FLAECHEN = [
  'grund',
  'flaeche',
  'flaeche2',
  'flaeche3',
  'paneel',
  'kopf',
  'normalFlaeche',
  'achtungFlaeche',
  'alarmFlaeche',
  'bedienFlaeche',
  'bannerGrund',
  'berichtigungZeile',
  'lueckeZeile',
  'problemZeile',
  // Deeplink-Hervorhebung (LFH-696): die angesteuerte Zeile ist ein Textgrund wie jede Zeilentönung.
  'hervorhebungZeile',
] as const satisfies readonly (keyof Farbrollen)[];

const MODI = [
  ['hell', farbenHell],
  ['dunkel', farbenDunkel],
] as const;

describe.each(MODI)('Textstufen im Modus %s (LFH-643)', (modus, farben) => {
  it.each(STUFEN)('„%s“ hält auf jeder deckenden Fläche den Textboden', (stufe) => {
    for (const flaeche of DECKENDE_FLAECHEN) {
      const wert = kontrast(farben[stufe], farben[flaeche]);
      expect(wert, `${modus}: ${stufe} auf ${flaeche} = ${wert.toFixed(2)}`).toBeGreaterThanOrEqual(
        BODEN[modus],
      );
    }
  });

  it.each(STUFEN.slice(1).map((stufe, i) => [STUFEN[i], stufe] as const))(
    '„%s“ und „%s“ liegen ≥ 5 ΔL* auseinander',
    (staerker, schwaecher) => {
      const delta = Math.abs(lab(farben[staerker])[0] - lab(farben[schwaecher])[0]);
      expect(
        delta,
        `${modus}: ΔL* ${staerker}/${schwaecher} = ${delta.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(STUFENABSTAND);
    },
  );

  it('ordnet die Stufen vom stärksten zum schwächsten Kontrast auf grund', () => {
    const werte = STUFEN.map((stufe) => kontrast(farben[stufe], farben.grund));
    expect(werte).toEqual([...werte].sort((a, b) => b - a));
    expect(new Set(werte).size).toBe(STUFEN.length);
  });
});
