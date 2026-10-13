import { theme as antdTheme } from 'antd';
import { describe, expect, it } from 'vitest';
import { kontrast, lab } from '../test/farbmass';
import { antdAlgorithmus, antdToken, farbenDunkel, farbenHell, type Farbrollen } from './tokens';

/**
 * Schrift gesperrter Steuerelemente (LLH-1228), GERECHNET statt behauptet (WCAG-Formel).
 *
 * antd leitete `colorTextDisabled` aus `colorTextQuaternary` ab (25 % Deckkraft); ein gesperrter
 * Knopf („Hinzufügen“ ohne Auswahl) lag auf seiner Sperrfläche Tag bei 1,81, Nacht bei 2,28.
 * Gesperrtes hält den Gesperrt-Boden ≥ 4,5 : 1 (Spec `textstufen-kontrast`), und zwar auf der
 * Fläche, die antd darunterlegt: `colorBgContainerDisabled` ist durchscheinend und wird über
 * jede deckende Fläche gelegt. Sie dunkelt am Tag ab und hellt nachts auf, ist also in beiden
 * Modi der knappere Grund; ohne sie (Link-, Textknopf, Menüeintrag) wird zusätzlich gerechnet.
 *
 * Geprüft wird der AUFGELÖSTE Token mit dem echten Algorithmus je Modus. Böden als Literale;
 * gemessen in `e2e/gesperrt-kontrast.spec.ts`.
 */
const GESPERRT_BODEN = 4.5;
/** Gesperrt bleibt sichtbar schwächer als freie Schrift (`text`), Abstand in ΔL*. */
const ABSTAND_ZU_TEXT = 20;

/** Dieselbe Liste deckender Flächen wie `textstufen.test.ts`. */
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
] as const satisfies readonly (keyof Farbrollen)[];

/** Eine Farbe deckend über einen Grund gelegt; `#rrggbb` deckt selbst. */
function gemischt(grund: string, farbe: string): string {
  if (/^#[0-9a-f]{6}$/i.test(farbe)) return farbe;
  const treffer = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(farbe);
  if (!treffer) throw new Error(`Nicht unterstützte Farbe: ${farbe}`);
  const alpha = Number(treffer[4]);
  return `#${[1, 3, 5]
    .map((i, k) => {
      const unten = Number.parseInt(grund.slice(i, i + 2), 16);
      const oben = Number(treffer[k + 1]);
      return Math.round(unten * (1 - alpha) + oben * alpha)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

describe.each([
  ['Tag', farbenHell, false],
  ['Nacht', farbenDunkel, true],
] as const)('Gesperrte Steuerelemente — %s (LLH-1228)', (modus, farben, dunkel) => {
  const aufgeloest = antdTheme.getDesignToken({
    token: antdToken(farben),
    algorithm: antdAlgorithmus(dunkel),
  });

  it('colorTextDisabled trägt die Rolle gesperrt', () => {
    expect(aufgeloest.colorTextDisabled).toBe(farben.gesperrt);
  });

  it('hält auf der Sperrfläche über jeder deckenden Fläche ≥ 4,5 : 1', () => {
    for (const flaeche of DECKENDE_FLAECHEN) {
      const grund = gemischt(farben[flaeche], aufgeloest.colorBgContainerDisabled);
      const wert = kontrast(farben.gesperrt, grund);
      expect(
        wert,
        `${modus}: gesperrt auf Sperrfläche über ${flaeche} = ${wert.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(GESPERRT_BODEN);
    }
  });

  it('hält ohne Sperrfläche auf jeder deckenden Fläche ≥ 4,5 : 1', () => {
    for (const flaeche of DECKENDE_FLAECHEN) {
      const wert = kontrast(farben.gesperrt, farben[flaeche]);
      expect(wert, `${modus}: gesperrt auf ${flaeche} = ${wert.toFixed(2)}`).toBeGreaterThanOrEqual(
        GESPERRT_BODEN,
      );
    }
  });

  it('bleibt sichtbar schwächer als freie Schrift', () => {
    const delta = Math.abs(lab(farben.text)[0] - lab(farben.gesperrt)[0]);
    expect(delta, `${modus}: ΔL* text/gesperrt = ${delta.toFixed(1)}`).toBeGreaterThanOrEqual(
      ABSTAND_ZU_TEXT,
    );
  });
});
