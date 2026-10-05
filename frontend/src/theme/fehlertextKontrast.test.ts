import { theme } from 'antd';
import { describe, expect, it } from 'vitest';
import { antdAlgorithmus, antdToken, farbenDunkel, farbenHell, type Farbrollen } from './tokens';

/**
 * Roter Fehlertext außerhalb von Formularen, GERECHNET statt behauptet (WCAG-Formel).
 *
 * LFH-874, Spec `textkontrast-rollen`: `Typography` `danger` („nicht gefunden“, „Überfällig“,
 * Ablehnungsgrund) und die übrigen Schriftleser von antds `colorErrorText` halten den Textboden
 * aus Kriterium 5, Tag ≥ 7 : 1, Nacht ≥ 5 : 1, auf jeder deckenden Fläche, in Ruhe, unter dem
 * Zeiger und gedrückt. Die Werte kommen aus dem AUFGELÖSTEN antd-Token (Override plus Algorithmus),
 * nicht aus den Rollen: ein vergessenes Token oder ein Nacht-Algorithmus, der den Override
 * schluckt, muss hier rot werden. Böden als Literale; der Browser-Nachweis steht in
 * `e2e/fehlertext-kontrast.spec.ts`.
 */
function luminanz(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a: string, b: string): number {
  const [x, y] = [luminanz(a), luminanz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Jede deckende Fläche, auf der roter Text stehen kann; `alarmFlaeche` ist die alarmierte Karte. */
const FLAECHEN = [
  'grund',
  'flaeche',
  'flaeche2',
  'flaeche3',
  'paneel',
  'kopf',
  'alarmFlaeche',
] as const satisfies readonly (keyof Farbrollen)[];

describe.each([
  ['Tag', farbenHell, false, 7],
  ['Nacht', farbenDunkel, true, 5],
] as const)('Fehlertext — %s (LFH-874)', (_modus, farben, dunkel, boden) => {
  const aufgeloest = theme.getDesignToken({
    token: antdToken(farben),
    algorithm: antdAlgorithmus(dunkel),
  });

  describe.each(['colorErrorText', 'colorErrorTextHover', 'colorErrorTextActive'] as const)(
    '%s',
    (name) => {
      it.each(FLAECHEN)('auf %s', (flaeche) => {
        expect(kontrast(aufgeloest[name], farben[flaeche])).toBeGreaterThanOrEqual(boden);
      });
    },
  );

  it('das globale Gefahrrot bleibt die Füllfarbe', () => {
    expect(aufgeloest.colorError.toLowerCase()).toBe(farben.alarm.toLowerCase());
  });
});
