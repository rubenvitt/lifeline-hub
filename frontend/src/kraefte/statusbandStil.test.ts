import { describe, expect, it } from 'vitest';
import { bandVerteilung } from './statusbandStil';
import { farbenHell } from '../theme/tokens';

describe('bandVerteilung', () => {
  it('Wort ist der Code, ohne Code das Wort; Anteil an der Summe; Farbe ist die Kante des Tons', () => {
    expect(
      bandVerteilung(
        [
          { schluessel: 'a', code: 'S4', wert: 3, wort: 'Am Einsatzort', ton: 'achtung' },
          { schluessel: 'b', code: null, wert: 1, wort: 'gemischt', ton: 'neutral' },
        ],
        farbenHell,
      ),
    ).toEqual([
      {
        schluessel: 'a',
        wort: 'S4',
        beschreibung: 'Am Einsatzort',
        wert: 3,
        anteil: 0.75,
        balkenFarbe: farbenHell.achtung,
      },
      {
        schluessel: 'b',
        wort: 'gemischt',
        beschreibung: undefined,
        wert: 1,
        anteil: 0.25,
        balkenFarbe: farbenHell.schwach,
      },
    ]);
  });

  it('ohne Zellen keine Zeile — und kein Teilen durch null', () => {
    expect(bandVerteilung([], farbenHell)).toEqual([]);
  });
});
