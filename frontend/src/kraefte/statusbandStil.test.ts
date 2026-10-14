import { describe, expect, it } from 'vitest';
import { bandSegmente } from './statusbandStil';
import { farbenHell } from '../theme/tokens';

describe('bandSegmente', () => {
  it('Etikett ist der Code, ohne Code das Wort; die Farbe ist die Kante des Tons', () => {
    expect(
      bandSegmente(
        [
          { schluessel: 'a', code: 'S4', wert: 2, wort: 'Am Einsatzort', ton: 'achtung' },
          { schluessel: 'b', code: null, wert: 1, wort: 'gemischt', ton: 'neutral' },
        ],
        farbenHell,
      ),
    ).toEqual([
      { label: 'S4', wert: 2, farbe: farbenHell.achtung },
      { label: 'gemischt', wert: 1, farbe: farbenHell.schwach },
    ]);
  });
});
